import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadRuns } from './report';
import { runMatrix } from './runner';
import type { EvalTask } from './types';

/**
 * SLOOP_DRY_RUN plumbing smoke (handoff task 7): exercise the runner end-to-end on one
 * handmade task for BOTH systems through the real CascadeEngine, with the Pi agent
 * skipped. Asserts the wiring (workspace setup, repo reset, kickoff+auto-approve, held-out,
 * runs.jsonl) — NOT real numbers (cost is $0; agents never ran).
 */

const WORKSPACE_TEMPLATE = path.resolve('fixtures', 'sample-workspace');
const TOOLKIT_SRC = path.resolve('evals', 'repos', 'toolkit');

let reposRoot: string;
let outDir: string;
let scratchRoot: string;

const task: EvalTask = {
  id: 'smoke-slugify',
  source: 'handmade',
  repo: 'toolkit',
  baseRef: 'main',
  adrPath: 'loops/adr-030-slugify.md',
  heldOut: ['node --test test/slugify.test.js', 'node --test test/regression.test.js'],
  modelMixes: [{ plan: 'opus', execute: 'haiku' }],
  body: '# Add slugify\n\nAdd a `slugify` function to src/index.js.',
  title: 'Add slugify',
};

beforeAll(async () => {
  reposRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sloop-smoke-repos-'));
  outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sloop-smoke-out-'));
  scratchRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sloop-smoke-scratch-'));
  await fs.cp(TOOLKIT_SRC, path.join(reposRoot, 'toolkit'), { recursive: true });
});

afterAll(async () => {
  await Promise.all(
    [reposRoot, outDir, scratchRoot].map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

describe('runMatrix — SLOOP_DRY_RUN plumbing smoke', () => {
  it('runs one task across both systems and writes runs.jsonl (no real cost)', async () => {
    const { runs, meta } = await runMatrix({
      runId: 'smoke',
      createdAt: '2026-06-13T00:00:00.000Z',
      trials: 1,
      tasks: [task],
      systems: ['sloop', 'baseline-flat'],
      outDir,
      workspaceTemplateDir: WORKSPACE_TEMPLATE,
      reposRoot,
      scratchRoot,
      env: { ...process.env, SLOOP_DRY_RUN: '1' },
      clock: (() => {
        let t = 0;
        return () => (t += 1000); // deterministic latency, no real clock
      })(),
    });

    expect(meta.dryRun).toBe(true);
    expect(runs).toHaveLength(2); // 1 task × 1 mix × 2 systems × 1 trial

    // No agent ran → no spend.
    for (const r of runs) {
      expect(r.cost.usd).toBe(0);
      expect(r.error).toBeNull();
    }

    const sloop = runs.find((r) => r.system === 'sloop')!;
    const baseline = runs.find((r) => r.system === 'baseline-flat')!;

    // sloop: the canned dry-run plan (one criterion-free leaf) converges vacuously.
    expect(sloop.converged).toBe(true);
    expect(sloop.tree.loops).toBeGreaterThanOrEqual(1);

    // baseline: the (skipped) agent "completes" trivially in dry-run.
    expect(baseline.converged).toBe(true);

    // Held-out runs for real against the BASE repo: slugify is absent, so the hidden
    // suite fails → not an independent pass → and for sloop that's a false positive.
    expect(sloop.independentPass).toBe(false);
    expect(sloop.falsePositive).toBe(true);

    // runs.jsonl was written and round-trips.
    const persisted = await loadRuns(path.join(outDir, 'runs.jsonl'));
    expect(persisted).toHaveLength(2);
  }, 120_000);
});
