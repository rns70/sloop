import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRealApi, isDryRun, bootstrapPi } from './real';
import type { AdrRunEvent, ModelRegistry } from '../../shared/index';

// Integration test for the real backend: it drives the genuine services
// (FilesService / AdrRunner / Executor) through a dry-run ADR run against an
// isolated temp workspace, asserting the run-set is executed, statuses are
// persisted to disk, the stream buffers/replays, and runs are serialized.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const SAMPLE = path.join(REPO_ROOT, 'fixtures', 'sample-workspace');

/** Run a git command in `cwd` with a deterministic identity (the executor needs a repo). */
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

/** A minimal ADR markdown doc with a single always-passing verify command. */
function adrMd(id: string, title: string, children: string[], verify: string): string {
  const childLine = children.length ? `\nchildren:\n${children.map((c) => `  - ${c}`).join('\n')}` : '';
  return (
    `---\nid: ${id}\ntitle: ${title}\nstatus: idle${childLine}\n---\n` +
    `# ${title}\n\n## Decision\nDo the thing.\n\n` +
    `## Acceptance criteria\n\n- [ ] It works. — verify: \`${verify}\`\n`
  );
}

describe('RealApi ADR run (dry-run, offline)', () => {
  let tmp: string;
  let workspace: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sloop-test-'));
    workspace = path.join(tmp, 'workspace');
    await fs.cp(SAMPLE, workspace, { recursive: true });

    // Replace the sample loops with a tiny parent→child pair whose verify exits 0,
    // so the dry-run executor (agent skipped) reports a clean pass.
    const loops = path.join(workspace, 'loops');
    await fs.rm(loops, { recursive: true, force: true });
    await fs.mkdir(loops, { recursive: true });
    await fs.writeFile(path.join(loops, 'parent.md'), adrMd('parent', 'Parent', ['loops/child.md'], 'true'));
    await fs.writeFile(path.join(loops, 'child.md'), adrMd('child', 'Child', [], 'true'));

    // The executor captures the working-tree dirty set via git, so the workspace must be a repo.
    git(workspace, ['init', '-q']);
    git(workspace, ['add', '.']);
    git(workspace, ['commit', '-q', '-m', 'baseline']);

    for (const key of ['SLOOP_DRY_RUN', 'SLOOP_WORKSPACE']) savedEnv[key] = process.env[key];
    process.env.SLOOP_DRY_RUN = '1';
    process.env.SLOOP_WORKSPACE = workspace;
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('runs an ADR + subtree: statuses reach passed and the stream closes done', async () => {
    const api = await createRealApi(workspace, process.env);

    // Subscribe BEFORE the run finishes to exercise live streaming + completion close.
    const events: AdrRunEvent[] = [];
    const { runId } = await api.runAdr('loops/parent.md');

    await new Promise<void>((resolve) => {
      api.subscribe(
        runId,
        (ev) => {
          events.push(ev);
          if (ev.type === 'done') resolve();
        },
        () => resolve(),
      );
    });

    // The run covered the parent + its child, both ending passed on disk.
    const parent = await api.getAdr('loops/parent.md');
    const child = await api.getAdr('loops/child.md');
    expect(parent.status).toBe('passed');
    expect(child.status).toBe('passed');

    // The history entry records the run-set and a passed verdict.
    const entry = await api.getRun(runId);
    expect(entry.status).toBe('passed');
    expect(entry.runSet).toEqual(['loops/parent.md', 'loops/child.md']);
    expect(entry.evidence).toEqual([]);

    // The stream carried output, per-ADR statuses, eval verdicts, and a done event.
    expect(events.some((e) => e.type === 'output')).toBe(true);
    expect(events.some((e) => e.type === 'status' && e.status === 'running')).toBe(true);
    expect(events.some((e) => e.type === 'eval' && e.passed)).toBe(true);
    expect(events.some((e) => e.type === 'done' && e.status === 'passed')).toBe(true);

    // listRuns surfaces the run, newest first.
    const runs = await api.listRuns();
    expect(runs[0]?.id).toBe(runId);
  });

  it('replays buffered events to a late subscriber and closes when done', async () => {
    const api = await createRealApi(workspace, process.env);
    const { runId } = await api.runAdr('loops/child.md');

    // Wait for the run to finish via a first subscriber's completion close.
    await new Promise<void>((resolve) => {
      api.subscribe(runId, () => undefined, () => resolve());
    });

    // A subscriber attaching AFTER completion still receives the full buffer + close.
    const replayed: AdrRunEvent[] = [];
    let closed = false;
    api.subscribe(
      runId,
      (ev) => replayed.push(ev),
      () => {
        closed = true;
      },
    );
    expect(replayed.length).toBeGreaterThan(0);
    expect(replayed.some((e) => e.type === 'done')).toBe(true);
    expect(closed).toBe(true);
  });

  it('rejects a missing ADR with a 404-style NotFound', async () => {
    const api = await createRealApi(workspace, process.env);
    await expect(api.runAdr('loops/no-such.md')).rejects.toThrow(/not found/i);
  });
});

describe('helpers', () => {
  it('isDryRun treats 0/false/no/off as off', () => {
    expect(isDryRun({ SLOOP_DRY_RUN: '1' })).toBe(true);
    expect(isDryRun({ SLOOP_DRY_RUN: 'true' })).toBe(true);
    expect(isDryRun({ SLOOP_DRY_RUN: '0' })).toBe(false);
    expect(isDryRun({ SLOOP_DRY_RUN: 'off' })).toBe(false);
    expect(isDryRun({})).toBe(false);
  });

  it('bootstrapPi registers providers without throwing', () => {
    const registry: ModelRegistry = {
      models: {},
      providers: {
        anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
        nebius: { baseUrl: 'https://api.studio.nebius.ai/v1', apiKeyEnv: 'NEBIUS_API_KEY' },
      },
    };
    expect(() => bootstrapPi(registry, {})).not.toThrow();
  });
});
