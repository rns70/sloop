// End-to-end verification of the WP-6 happy path against the REAL backend, offline.
//
// Drives the exact services the server uses (createRealApi) through the full cascade
// lifecycle in SLOOP_DRY_RUN mode — no API keys, no network — so the convergence
// invariant can be proven reproducibly:
//
//   edit ADR → kickoff (spec-driven) → architect proposes tree (awaiting_approval)
//   → approve → leaf runs → each `verify` command runs in the target repo → passes
//   → status bubbles up → root flips to `done`.
//
// Everything happens in an isolated temp copy of the sample workspace, so the repo's
// fixtures stay pristine and the run is idempotent. Exit 0 = the root converged.
//
// Usage:  npx tsx scripts/verify-demo.ts
// (The live server uses the same code path; this is the headless, asserted version.)

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRealApi } from '../src/server/api/real';
import type { CascadeStreamEvent } from '../src/server/api/contract';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SAMPLE = path.join(ROOT, 'fixtures', 'sample-workspace');
const TARGET = path.join(ROOT, 'fixtures', 'sample-target-repo');
const ADR_REL = 'databank/adr-007-token-rotation.md';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'sloop',
      GIT_AUTHOR_EMAIL: 'sloop@earendil.works',
      GIT_COMMITTER_NAME: 'sloop',
      GIT_COMMITTER_EMAIL: 'sloop@earendil.works',
    },
  });
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.cp(src, dest, { recursive: true });
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(msg);
}

async function main(): Promise<void> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sloop-demo-'));
  const workspace = path.join(tmp, 'workspace');

  try {
    log(`▸ Isolated workspace: ${workspace}`);
    await copyDir(SAMPLE, workspace);

    // The databank is the source of desired state — it must be its own git repo so
    // `diffDatabank` reports databank/-scoped working-tree changes.
    git(workspace, ['init', '-q']);
    git(workspace, ['add', '.']);
    git(workspace, ['commit', '-q', '-m', 'baseline']);
    log('▸ Committed databank baseline.');

    // 1) Edit an ADR — tighten the rotation window 15 → 10 minutes. This is the
    //    databank delta the cascade reconciles.
    const adrPath = path.join(workspace, ADR_REL);
    const before = await fs.readFile(adrPath, 'utf8');
    const edited = before
      .replace('within ≤15 minutes', 'within ≤10 minutes')
      .replace('Cap refresh-token lifetime at 15 minutes.', 'Cap refresh-token lifetime at 10 minutes.');
    await fs.writeFile(adrPath, edited, 'utf8');
    log('▸ Edited ADR-007 (15 → 10 minute rotation window).');

    // 2) Configure the real backend for an offline run.
    process.env.SLOOP_DRY_RUN = '1';
    process.env.SLOOP_TARGET_REPO = TARGET;
    process.env.SLOOP_MAX_DEPTH = '2';
    process.env.SLOOP_PLANNER_MODEL = 'opus';
    process.env.SLOOP_WORKSPACE = workspace;

    const api = await createRealApi(workspace, process.env);

    // 3) Kickoff — architect proposes the tree (awaiting approval).
    const summary = await api.createCascade({ templateId: 'spec-driven' });
    log(`▸ Kickoff → cascade ${summary.id} (${summary.status}); deltas=${JSON.stringify(summary.deltas)}`);
    if (summary.status !== 'awaiting_approval') {
      throw new Error(`expected awaiting_approval after kickoff, got ${summary.status}`);
    }

    const detailBefore = await api.getCascade(summary.id);
    const leafCount = detailBefore.loops.filter((l) => l.frontmatter.kind === 'leaf').length;
    log(`▸ Proposed ${detailBefore.loops.length} loop(s): 1 architect + ${leafCount} leaf.`);

    // 4) Subscribe to the live stream, then approve. Collect every event + output.
    const events: CascadeStreamEvent[] = [];
    const outputByLoop = new Map<string, string>();
    const streamDone = new Promise<void>((resolveDone) => {
      api.subscribe(
        summary.id,
        (ev) => {
          events.push(ev);
          if (ev.type === 'output') {
            outputByLoop.set(ev.loopId, (outputByLoop.get(ev.loopId) ?? '') + ev.chunk);
          }
        },
        () => resolveDone(),
      );
    });

    log('▸ Approved checkpoint — running leaves…');
    await api.approveCascade(summary.id);
    await streamDone;

    // 5) Convergence: re-read and assert the root flipped to done.
    const detail = await api.getCascade(summary.id);
    const root = detail.loops.find((l) => l.frontmatter.id === detail.summary.rootLoopId);
    const rootStatus = root?.frontmatter.status ?? detail.summary.status;

    log('\n── Agent / verify output ──────────────────────────────');
    for (const [loopId, text] of outputByLoop) {
      log(`[${loopId}]\n${text.trim()}`);
    }
    log('───────────────────────────────────────────────────────\n');

    const loopUpdates = events.filter((e) => e.type === 'loop-update').length;
    log(`▸ Stream: ${events.length} events (${loopUpdates} loop-updates).`);
    log('▸ Final loop statuses:');
    for (const l of detail.loops) {
      const crit = l.frontmatter.acceptanceCriteria;
      const passed = crit.filter((c) => c.passed).length;
      log(`    ${l.frontmatter.id.padEnd(34)} ${l.frontmatter.status.padEnd(12)} criteria ${passed}/${crit.length}`);
    }

    if (rootStatus !== 'done') {
      throw new Error(`root did not converge: status=${rootStatus}`);
    }

    log(`\n✅ HAPPY PATH VERIFIED — cascade ${summary.id} root is DONE. Codebase matches databank.`);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`\n❌ verify-demo failed: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
