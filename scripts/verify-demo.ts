// End-to-end verification of the demo happy path against the REAL backend, offline.
//
// Drives the exact services the server uses (createRealApi) through a full ADR run
// in SLOOP_DRY_RUN mode — no API keys, no network — so the convergence invariant can
// be proven reproducibly:
//
//   edit ADR → runAdr → each acceptance criterion's `verify` command runs in the
//   workspace → passes → status persists to disk → the ADR flips to `passed` and the
//   run stream closes `done`.
//
// Dry-run skips the coding agent itself, so this asserts the loop machinery (run-set
// selection, verify execution, status bubbling, stream lifecycle) rather than model
// output. Everything happens in an isolated temp copy of the sample workspace, so the
// repo's fixtures stay pristine and the run is idempotent. Exit 0 = the ADR converged.
//
// Usage:  npx tsx scripts/verify-demo.ts
// (The live server uses the same code path; this is the headless, asserted version.)

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRealApi } from '../src/server/api/real';
import type { AdrRunEvent } from '../src/shared/index';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SAMPLE = path.join(ROOT, 'fixtures', 'sample-workspace');
const ADR_REL = 'loops/adr-007-token-rotation.md';

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

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(msg);
}

async function main(): Promise<void> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sloop-demo-'));
  const workspace = path.join(tmp, 'workspace');

  try {
    log(`▸ Isolated workspace: ${workspace}`);
    await fs.cp(SAMPLE, workspace, { recursive: true });

    // The workspace is the source of desired state — it must be its own git repo so the
    // executor can capture the working-tree dirty set and report ADR-scoped diffs.
    git(workspace, ['init', '-q']);
    git(workspace, ['add', '.']);
    git(workspace, ['commit', '-q', '-m', 'baseline']);
    log('▸ Committed workspace baseline.');

    // 1) Edit an ADR — tighten the rotation window 15 → 10 minutes. This is the loop
    //    delta a real run would reconcile the codebase against.
    const adrPath = path.join(workspace, ADR_REL);
    const before = await fs.readFile(adrPath, 'utf8');
    const edited = before
      .replace('within ≤15 minutes', 'within ≤10 minutes')
      .replace('Cap refresh-token lifetime at 15 minutes.', 'Cap refresh-token lifetime at 10 minutes.');
    await fs.writeFile(adrPath, edited, 'utf8');
    log('▸ Edited ADR-007 (15 → 10 minute rotation window).');

    // 2) Configure the real backend for an offline run.
    process.env.SLOOP_DRY_RUN = '1';
    process.env.SLOOP_WORKSPACE = workspace;

    const api = await createRealApi(workspace, process.env);

    // 3) Run the ADR + its subtree as a single pass; subscribe BEFORE it finishes so we
    //    exercise live streaming and the completion close.
    const events: AdrRunEvent[] = [];
    const outputByAdr = new Map<string, string>();
    const { runId } = await api.runAdr(ADR_REL);
    log(`▸ Kickoff → run ${runId}; reconciling ${ADR_REL}…`);

    await new Promise<void>((resolve) => {
      api.subscribe(
        runId,
        (ev) => {
          events.push(ev);
          if (ev.type === 'output') {
            outputByAdr.set(ev.relPath, (outputByAdr.get(ev.relPath) ?? '') + ev.chunk);
          }
          if (ev.type === 'done') resolve();
        },
        () => resolve(),
      );
    });

    // 4) Convergence: re-read the run-set from disk and assert every ADR passed.
    const entry = await api.getRun(runId);

    log('\n── Agent / verify output ──────────────────────────────');
    for (const [relPath, text] of outputByAdr) {
      log(`[${relPath}]\n${text.trim()}`);
    }
    log('───────────────────────────────────────────────────────\n');

    const loopUpdates = events.filter((e) => e.type === 'status').length;
    log(`▸ Stream: ${events.length} events (${loopUpdates} status updates).`);
    log('▸ Final ADR statuses:');
    // Per-criterion verdicts live in the run stream (eval events), not the ADR frontmatter.
    for (const relPath of entry.runSet) {
      const adr = await api.getAdr(relPath);
      const evals = events.filter((e) => e.type === 'eval' && e.relPath === relPath);
      const passed = evals.filter((e) => e.type === 'eval' && e.passed).length;
      log(`    ${relPath.padEnd(40)} ${String(adr.status).padEnd(10)} criteria ${passed}/${evals.length}`);
    }

    if (entry.status !== 'passed') {
      throw new Error(`run did not converge: status=${entry.status}`);
    }
    const adr = await api.getAdr(ADR_REL);
    if (adr.status !== 'passed') {
      throw new Error(`ADR did not converge: status=${adr.status}`);
    }

    log(`\n✅ HAPPY PATH VERIFIED — run ${runId} passed. Codebase matches the databank.`);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`\n❌ verify-demo failed: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
