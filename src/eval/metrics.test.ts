import { describe, expect, it } from 'vitest';
import { aggregate, mean, mixKey, stat, stdev } from './metrics';
import type { EvalSystem, ModelMix, RunResult } from './types';

/** Build a RunResult with sensible defaults; override only what a test cares about. */
function run(overrides: Partial<RunResult> & Pick<RunResult, 'taskId' | 'system'>): RunResult {
  const mix: ModelMix = overrides.modelMix ?? { plan: 'opus', execute: 'haiku' };
  const converged = overrides.converged ?? false;
  const independentPass = overrides.independentPass ?? false;
  return {
    taskId: overrides.taskId,
    system: overrides.system,
    modelMix: mix,
    trial: overrides.trial ?? 0,
    converged,
    independentPass,
    falsePositive: overrides.falsePositive ?? (converged && !independentPass),
    criteria: overrides.criteria ?? { total: 3, passedByAgent: 3, passedIndependent: 3 },
    tree: overrides.tree ?? { loops: 4, maxDepth: 2 },
    cost: overrides.cost ?? { usd: 0.1, tokensIn: 1000, tokensOut: 200, byModel: {} },
    latencyMs: overrides.latencyMs ?? 1000,
    error: overrides.error ?? null,
  };
}

function cost(usd: number) {
  return { usd, tokensIn: 1000, tokensOut: 200, byModel: {} };
}

describe('numeric helpers', () => {
  it('mean of empty is 0; stdev needs n>=2', () => {
    expect(mean([])).toBe(0);
    expect(stdev([])).toBe(0);
    expect(stdev([5])).toBe(0);
    expect(mean([2, 4, 6])).toBe(4);
  });

  it('sample stdev (n-1)', () => {
    // values 2,4,4,4,5,5,7,9 -> sample stdev = 2.138...
    const s = stat([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(s.mean).toBe(5);
    expect(s.n).toBe(8);
    expect(s.stdev).toBeCloseTo(2.138, 2);
  });
});

describe('aggregate — convergence & false-positive', () => {
  it('computes per-system convergence and false-positive rates', () => {
    const runs: RunResult[] = [
      run({ taskId: 't1', system: 'sloop', converged: true, independentPass: true }),
      run({ taskId: 't2', system: 'sloop', converged: true, independentPass: false }), // false positive
      run({ taskId: 't3', system: 'sloop', converged: false, independentPass: false }),
      run({ taskId: 't4', system: 'sloop', converged: true, independentPass: true }),
    ];
    const agg = aggregate(runs);
    const sloop = agg.bySystem.find((s) => s.system === 'sloop')!;
    expect(sloop.runs).toBe(4);
    expect(sloop.convergenceRate).toBe(0.75); // 3/4 converged
    expect(sloop.falsePositiveRate).toBe(0.25); // 1/4 converged-but-failed
    expect(sloop.independentPassRate).toBe(0.5); // 2/4 truly passed
  });

  it('only includes systems that have runs', () => {
    const agg = aggregate([run({ taskId: 't1', system: 'sloop', converged: true })]);
    expect(agg.bySystem.map((s) => s.system)).toEqual(['sloop']);
    expect(agg.delta).toBeNull(); // no baseline -> no delta
  });
});

describe('aggregate — per-mix cost table', () => {
  it('groups by (system × mix) with means', () => {
    const cheap: ModelMix = { plan: 'opus', execute: 'haiku' };
    const pricey: ModelMix = { plan: 'opus', execute: 'opus' };
    const runs: RunResult[] = [
      run({ taskId: 't1', system: 'sloop', modelMix: cheap, independentPass: true, cost: cost(0.2) }),
      run({ taskId: 't2', system: 'sloop', modelMix: cheap, independentPass: true, cost: cost(0.4) }),
      run({ taskId: 't1', system: 'sloop', modelMix: pricey, independentPass: true, cost: cost(1.0) }),
    ];
    const agg = aggregate(runs);
    const cheapRow = agg.byMix.find((m) => m.key === mixKey(cheap))!;
    const priceyRow = agg.byMix.find((m) => m.key === mixKey(pricey))!;
    expect(cheapRow.runs).toBe(2);
    expect(cheapRow.meanUsd).toBeCloseTo(0.3, 6);
    expect(cheapRow.successRate).toBe(1);
    expect(priceyRow.meanUsd).toBeCloseTo(1.0, 6);
    expect(agg.byMix.every((m) => m.system === 'sloop')).toBe(true);
  });
});

describe('aggregate — sloop-vs-baseline delta', () => {
  it('compares only the shared tasks; reports resolved% and $ deltas', () => {
    const runs: RunResult[] = [
      // shared tasks t1,t2; sloop also ran t3 (excluded from delta)
      run({ taskId: 't1', system: 'sloop', independentPass: true, cost: cost(0.5) }),
      run({ taskId: 't2', system: 'sloop', independentPass: true, cost: cost(0.5) }),
      run({ taskId: 't3', system: 'sloop', independentPass: true, cost: cost(0.5) }),
      run({ taskId: 't1', system: 'baseline-flat', independentPass: true, cost: cost(0.8) }),
      run({ taskId: 't2', system: 'baseline-flat', independentPass: false, cost: cost(0.8) }),
    ];
    const agg = aggregate(runs);
    expect(agg.delta).not.toBeNull();
    const d = agg.delta!;
    expect(d.tasksCompared).toBe(2); // t1,t2 only
    expect(d.resolvedPctSloop).toBe(100); // both shared sloop runs passed
    expect(d.resolvedPctBaseline).toBe(50); // 1/2 baseline passed
    expect(d.resolvedPctDelta).toBe(50);
    expect(d.meanUsdSloop).toBeCloseTo(0.5, 6);
    expect(d.meanUsdBaseline).toBeCloseTo(0.8, 6);
    expect(d.meanUsdDelta).toBeCloseTo(-0.3, 6); // sloop cheaper
  });
});

describe('aggregate — trials > 1 variance & pass@k', () => {
  it('reports mean ± stdev across trials and pass@k', () => {
    const mix: ModelMix = { plan: 'opus', execute: 'haiku' };
    // 1 task, 1 mix, 3 trials. Trial 0 passes, trials 1,2 fail.
    const mk = (trial: number, pass: boolean, sys: EvalSystem): RunResult =>
      run({ taskId: 't1', system: sys, modelMix: mix, trial, converged: pass, independentPass: pass });
    const runs: RunResult[] = [mk(0, true, 'sloop'), mk(1, false, 'sloop'), mk(2, false, 'sloop')];
    const agg = aggregate(runs);
    expect(agg.trials).toBe(3);
    expect(agg.variance).toBeDefined();
    const cr = agg.variance!.convergenceRate.sloop!;
    // per-trial convergence rates: [1, 0, 0] -> mean 1/3, sample stdev = sqrt(1/3)
    expect(cr.mean).toBeCloseTo(1 / 3, 6);
    expect(cr.stdev).toBeCloseTo(Math.sqrt(1 / 3), 6);
    expect(cr.n).toBe(3);
    // pass@k: the single group had >=1 passing trial -> 1.0
    expect(agg.variance!.passAtK.sloop).toBe(1);
    expect(agg.variance!.k).toBe(3);
  });

  it('no variance block when trials == 1', () => {
    const agg = aggregate([run({ taskId: 't1', system: 'sloop' })]);
    expect(agg.trials).toBe(1);
    expect(agg.variance).toBeUndefined();
  });
});
