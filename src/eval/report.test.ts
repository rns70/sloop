import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendRun, loadRuns, renderCompare, renderSummary } from './report';
import type { RunMeta, RunResult } from './types';

function c(usd: number) {
  return { usd, tokensIn: 1000, tokensOut: 200, byModel: {} };
}

function run(o: Partial<RunResult> & Pick<RunResult, 'taskId' | 'system'>): RunResult {
  const converged = o.converged ?? false;
  const independentPass = o.independentPass ?? false;
  return {
    taskId: o.taskId,
    system: o.system,
    modelMix: o.modelMix ?? { plan: 'opus', execute: 'haiku' },
    trial: o.trial ?? 0,
    converged,
    independentPass,
    falsePositive: o.falsePositive ?? (converged && !independentPass),
    criteria: { total: 2, passedByAgent: 2, passedIndependent: 2 },
    tree: { loops: 3, maxDepth: 2 },
    cost: o.cost ?? { usd: 0.1, tokensIn: 1000, tokensOut: 200, byModel: {} },
    latencyMs: o.latencyMs ?? 5000,
    error: null,
  };
}

const META: RunMeta = {
  runId: '20260613-demo',
  createdAt: '2026-06-13T12:00:00.000Z',
  trials: 1,
  taskIds: ['t1', 't2'],
  resolvedModels: [{ alias: 'opus', provider: 'anthropic', id: 'claude-opus-4-8' }],
  dryRun: false,
};

describe('renderSummary', () => {
  const runs = [
    run({ taskId: 't1', system: 'sloop', converged: true, independentPass: true, cost: c(0.4) }),
    run({ taskId: 't2', system: 'sloop', converged: true, independentPass: false, cost: c(0.4) }),
    run({ taskId: 't1', system: 'baseline-flat', converged: true, independentPass: false, cost: c(0.9) }),
    run({ taskId: 't2', system: 'baseline-flat', converged: false, independentPass: false, cost: c(0.9) }),
  ];

  it('includes the headline, mix table, delta, Nemotron section, and SWE-bench backdrop', () => {
    const md = renderSummary(runs, META, { swebenchLabel: '5 tasks from SWE-bench Lite' });
    expect(md).toContain('True-convergence rate');
    expect(md).toContain('False-positive rate');
    expect(md).toContain('Cost vs. model mix');
    expect(md).toContain('sloop vs. baseline-flat');
    expect(md).toContain('Nemotron'); // multi-provider section present even with no nemotron runs
    expect(md).toContain('59%'); // SWE-bench Pro standardized backdrop
    expect(md).toContain('Scaffold caveat');
    expect(md).toContain('5 tasks from SWE-bench Lite');
    expect(md).toContain('claude-opus-4-8'); // resolved-model pinning in header
  });

  it('marks a dry-run summary as plumbing-only, NOT headline numbers', () => {
    const md = renderSummary(runs, { ...META, dryRun: true });
    expect(md).toContain('SLOOP_DRY_RUN');
    expect(md).toContain('NOT');
  });
});

describe('renderCompare', () => {
  it('diffs resolved% and $ per system (B − A)', () => {
    const a = {
      meta: { ...META, runId: 'A' },
      runs: [run({ taskId: 't1', system: 'sloop', independentPass: false, cost: c(1.0) })],
    };
    const b = {
      meta: { ...META, runId: 'B' },
      runs: [run({ taskId: 't1', system: 'sloop', independentPass: true, cost: c(0.5) })],
    };
    const md = renderCompare(a, b);
    expect(md).toContain('`A`');
    expect(md).toContain('`B`');
    // sloop resolved 0% -> 100% (+100 pts), cost $1 -> $0.5 (−$0.5)
    expect(md).toContain('+100.0 pts');
    expect(md).toContain('-$0.5000');
  });
});

describe('runs.jsonl I/O', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sloop-eval-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('append then load round-trips run objects', async () => {
    const file = path.join(dir, 'runs.jsonl');
    const r1 = run({ taskId: 't1', system: 'sloop', converged: true, independentPass: true });
    const r2 = run({ taskId: 't1', system: 'baseline-flat' });
    await appendRun(file, r1);
    await appendRun(file, r2);
    const loaded = await loadRuns(file);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]).toEqual(r1);
    expect(loaded[1].system).toBe('baseline-flat');
  });
});
