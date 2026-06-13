import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRealApi, isDryRun, bootstrapPi } from './real';
import type { CascadeStreamEvent } from './contract';
import type { ModelRegistry } from '../../shared/index';

// Integration test for the WP-6 real backend: it drives the genuine services
// (FilesService/GitService/CascadeEngine/Executor) through the demo happy path in
// dry-run mode against an isolated temp workspace, and asserts the convergence
// invariant (root flips to done) plus the live-stream buffering/replay contract.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');
const SAMPLE = path.join(REPO_ROOT, 'fixtures', 'sample-workspace');
const TARGET = path.join(REPO_ROOT, 'fixtures', 'sample-target-repo');
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

describe('RealApi happy path (dry-run, offline)', () => {
  let tmp: string;
  let workspace: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sloop-test-'));
    workspace = path.join(tmp, 'workspace');
    await fs.cp(SAMPLE, workspace, { recursive: true });
    git(workspace, ['init', '-q']);
    git(workspace, ['add', '.']);
    git(workspace, ['commit', '-q', '-m', 'baseline']);

    // Create the databank delta the cascade reconciles.
    const adrPath = path.join(workspace, ADR_REL);
    const body = await fs.readFile(adrPath, 'utf8');
    await fs.writeFile(adrPath, body.replace('≤15 minutes', '≤10 minutes'), 'utf8');

    for (const key of [
      'SLOOP_DRY_RUN',
      'SLOOP_TARGET_REPO',
      'SLOOP_MAX_DEPTH',
      'SLOOP_PLANNER_MODEL',
      'SLOOP_WORKSPACE',
    ]) {
      savedEnv[key] = process.env[key];
    }
    process.env.SLOOP_DRY_RUN = '1';
    process.env.SLOOP_TARGET_REPO = TARGET;
    process.env.SLOOP_MAX_DEPTH = '2';
    process.env.SLOOP_PLANNER_MODEL = 'opus';
    process.env.SLOOP_WORKSPACE = workspace;
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('converges: kickoff → approve → verify passes → root done', async () => {
    const api = await createRealApi(workspace, process.env);

    const summary = await api.createCascade({ templateId: 'spec-driven' });
    expect(summary.status).toBe('awaiting_approval');
    expect(summary.deltas).toEqual({ add: 0, change: 1, delete: 0 });

    const proposed = await api.getCascade(summary.id);
    const leaves = proposed.loops.filter((l) => l.frontmatter.kind === 'leaf');
    expect(leaves.length).toBe(1);
    expect(leaves[0].frontmatter.acceptanceCriteria.length).toBe(2);

    // Subscribe BEFORE approve resolves to exercise live streaming + completion close.
    const events: CascadeStreamEvent[] = [];
    const done = new Promise<void>((resolve) => {
      api.subscribe(
        summary.id,
        (ev) => events.push(ev),
        () => resolve(),
      );
    });

    await api.approveCascade(summary.id);
    await done;

    const detail = await api.getCascade(summary.id);
    const root = detail.loops.find((l) => l.frontmatter.id === detail.summary.rootLoopId);
    expect(root?.frontmatter.status).toBe('done');
    expect(detail.summary.status).toBe('done');

    // Every leaf criterion was verified by a real command exit 0.
    const leaf = detail.loops.find((l) => l.frontmatter.kind === 'leaf');
    expect(leaf?.frontmatter.status).toBe('done');
    expect(leaf?.frontmatter.acceptanceCriteria.every((c) => c.passed)).toBe(true);

    // The stream carried both kinds of events and saw the root reach done.
    expect(events.some((e) => e.type === 'output')).toBe(true);
    const rootDone = events.some(
      (e) =>
        e.type === 'loop-update' &&
        e.loop.frontmatter.id === '_architect' &&
        e.loop.frontmatter.status === 'done',
    );
    expect(rootDone).toBe(true);
  });

  it('subscribe replays buffered events to a late subscriber and closes when done', async () => {
    const api = await createRealApi(workspace, process.env);
    const summary = await api.createCascade({ templateId: 'spec-driven' });

    // Wait for the run to actually finish (the stream's completion close fires).
    await new Promise<void>((resolve) => {
      api.subscribe(
        summary.id,
        () => undefined,
        () => resolve(),
      );
      void api.approveCascade(summary.id);
    });

    // A subscriber attaching AFTER completion still receives the full buffer + close.
    const replayed: CascadeStreamEvent[] = [];
    let closed = false;
    api.subscribe(
      summary.id,
      (ev) => replayed.push(ev),
      () => {
        closed = true;
      },
    );
    expect(replayed.length).toBeGreaterThan(0);
    expect(closed).toBe(true);
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
