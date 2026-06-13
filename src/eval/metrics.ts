/**
 * Pure aggregation over `RunResult[]` (WP-8, eval spec §4 + §10).
 *
 * No I/O, no clock — everything is computed from the run array passed in, so the
 * math is unit-tested directly on hand-built fixtures. `report.ts` turns the
 * {@link Aggregate} into `summary.md`.
 *
 * Headline metrics:
 *  - true-convergence rate + false-positive rate (spec §1)
 *  - per-mix success rate / mean cost / mean latency (claim 2, the cost story)
 *  - the sloop-vs-baseline-flat delta on identical tasks (spec §4–§5)
 *  - when trials > 1: mean ± stdev and pass@k per metric (spec §10)
 */

import type { EvalSystem, ModelMix, RunResult } from './types';

export const SYSTEMS: readonly EvalSystem[] = ['sloop', 'baseline-flat'];

/** A summary statistic over a sample (e.g. across trials). */
export interface Stat {
  mean: number;
  /** Sample standard deviation (n-1). 0 when n < 2. */
  stdev: number;
  n: number;
}

/** Aggregate stats for one system across all its runs. */
export interface SystemStats {
  system: EvalSystem;
  runs: number;
  /** Fraction of runs that converged (claimed done). */
  convergenceRate: number;
  /** Fraction of runs where converged but the held-out suite failed. */
  falsePositiveRate: number;
  /** Fraction of runs where the held-out suite passed (the honest success signal). */
  independentPassRate: number;
  meanUsd: number;
  meanLatencyMs: number;
}

/** Aggregate stats for one (system × mix) cell — the cost-vs-mix table rows. */
export interface MixStats {
  system: EvalSystem;
  mix: ModelMix;
  /** `${plan}->${execute}` — stable key for display + lookup. */
  key: string;
  runs: number;
  /** Fraction whose held-out suite passed (equal-success basis for cost compare). */
  successRate: number;
  convergenceRate: number;
  falsePositiveRate: number;
  meanUsd: number;
  meanLatencyMs: number;
}

/** sloop vs baseline-flat on the *same* tasks — the honest, scaffold-controlled delta. */
export interface SystemDelta {
  tasksCompared: number;
  resolvedPctSloop: number;
  resolvedPctBaseline: number;
  /** sloop − baseline (percentage points of independent-pass rate). */
  resolvedPctDelta: number;
  meanUsdSloop: number;
  meanUsdBaseline: number;
  /** sloop − baseline (USD per run). */
  meanUsdDelta: number;
}

/** Per-trial variance for headline metrics (only meaningful when trials > 1). */
export interface Variance {
  /** Mean ± stdev of each system's per-trial convergence rate. */
  convergenceRate: Partial<Record<EvalSystem, Stat>>;
  independentPassRate: Partial<Record<EvalSystem, Stat>>;
  falsePositiveRate: Partial<Record<EvalSystem, Stat>>;
  meanUsd: Partial<Record<EvalSystem, Stat>>;
  /**
   * pass@k per system: averaged over (task × mix) groups, the fraction with at
   * least one independent-pass across the group's k trials. Empirical estimate.
   */
  passAtK: Partial<Record<EvalSystem, number>>;
  /** k = trials. */
  k: number;
}

export interface Aggregate {
  totalRuns: number;
  /** Distinct trial count observed (max trial index + 1). */
  trials: number;
  bySystem: SystemStats[];
  byMix: MixStats[];
  /** sloop-vs-baseline on identical tasks; null if either system is absent. */
  delta: SystemDelta | null;
  /** Per-trial mean ± stdev + pass@k; only present when trials > 1. */
  variance?: Variance;
}

// ---- small numeric helpers ----------------------------------------------

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample standard deviation (n-1). Returns 0 for n < 2. */
export function stdev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

export function stat(xs: readonly number[]): Stat {
  return { mean: mean(xs), stdev: stdev(xs), n: xs.length };
}

/** Fraction of items satisfying `pred` (0 for an empty array). */
function rate<T>(xs: readonly T[], pred: (x: T) => boolean): number {
  if (xs.length === 0) return 0;
  return xs.filter(pred).length / xs.length;
}

export function mixKey(mix: ModelMix): string {
  return `${mix.plan}->${mix.execute}`;
}

// ---- aggregation ---------------------------------------------------------

function systemStats(system: EvalSystem, runs: readonly RunResult[]): SystemStats {
  return {
    system,
    runs: runs.length,
    convergenceRate: rate(runs, (r) => r.converged),
    falsePositiveRate: rate(runs, (r) => r.falsePositive),
    independentPassRate: rate(runs, (r) => r.independentPass),
    meanUsd: mean(runs.map((r) => r.cost.usd)),
    meanLatencyMs: mean(runs.map((r) => r.latencyMs)),
  };
}

function mixStats(system: EvalSystem, mix: ModelMix, runs: readonly RunResult[]): MixStats {
  return {
    system,
    mix,
    key: mixKey(mix),
    runs: runs.length,
    successRate: rate(runs, (r) => r.independentPass),
    convergenceRate: rate(runs, (r) => r.converged),
    falsePositiveRate: rate(runs, (r) => r.falsePositive),
    meanUsd: mean(runs.map((r) => r.cost.usd)),
    meanLatencyMs: mean(runs.map((r) => r.latencyMs)),
  };
}

/**
 * The sloop-vs-baseline delta, computed over the *intersection* of tasks both
 * systems ran (identical inputs + hidden tests — the only honest comparison).
 */
function computeDelta(runs: readonly RunResult[]): SystemDelta | null {
  const sloop = runs.filter((r) => r.system === 'sloop');
  const baseline = runs.filter((r) => r.system === 'baseline-flat');
  if (sloop.length === 0 || baseline.length === 0) return null;

  const sloopTasks = new Set(sloop.map((r) => r.taskId));
  const sharedTasks = new Set(
    baseline.filter((r) => sloopTasks.has(r.taskId)).map((r) => r.taskId),
  );
  if (sharedTasks.size === 0) return null;

  const s = sloop.filter((r) => sharedTasks.has(r.taskId));
  const b = baseline.filter((r) => sharedTasks.has(r.taskId));

  const resolvedPctSloop = rate(s, (r) => r.independentPass) * 100;
  const resolvedPctBaseline = rate(b, (r) => r.independentPass) * 100;
  const meanUsdSloop = mean(s.map((r) => r.cost.usd));
  const meanUsdBaseline = mean(b.map((r) => r.cost.usd));

  return {
    tasksCompared: sharedTasks.size,
    resolvedPctSloop,
    resolvedPctBaseline,
    resolvedPctDelta: resolvedPctSloop - resolvedPctBaseline,
    meanUsdSloop,
    meanUsdBaseline,
    meanUsdDelta: meanUsdSloop - meanUsdBaseline,
  };
}

/** Group runs by trial index, returning trials in ascending order. */
function byTrial(runs: readonly RunResult[]): RunResult[][] {
  const trials = [...new Set(runs.map((r) => r.trial))].sort((a, b) => a - b);
  return trials.map((t) => runs.filter((r) => r.trial === t));
}

function computeVariance(runs: readonly RunResult[], k: number): Variance {
  const v: Variance = {
    convergenceRate: {},
    independentPassRate: {},
    falsePositiveRate: {},
    meanUsd: {},
    passAtK: {},
    k,
  };

  for (const system of SYSTEMS) {
    const sysRuns = runs.filter((r) => r.system === system);
    if (sysRuns.length === 0) continue;

    // Per-trial point estimates -> mean ± stdev across trials.
    const trials = byTrial(sysRuns);
    v.convergenceRate[system] = stat(trials.map((t) => rate(t, (r) => r.converged)));
    v.independentPassRate[system] = stat(trials.map((t) => rate(t, (r) => r.independentPass)));
    v.falsePositiveRate[system] = stat(trials.map((t) => rate(t, (r) => r.falsePositive)));
    v.meanUsd[system] = stat(trials.map((t) => mean(t.map((r) => r.cost.usd))));

    // pass@k: per (task × mix) group, did ANY of the k trials pass the held-out suite?
    const groups = new Map<string, RunResult[]>();
    for (const r of sysRuns) {
      const g = `${r.taskId}|${mixKey(r.modelMix)}`;
      const bucket = groups.get(g);
      if (bucket) bucket.push(r);
      else groups.set(g, [r]);
    }
    const perGroup = [...groups.values()].map((g) => (g.some((r) => r.independentPass) ? 1 : 0));
    v.passAtK[system] = mean(perGroup);
  }

  return v;
}

/**
 * Aggregate a run array into the headline metrics. The only entry point report.ts
 * needs. Pure: same input -> same output.
 */
export function aggregate(runs: readonly RunResult[]): Aggregate {
  const trials = runs.length === 0 ? 0 : Math.max(...runs.map((r) => r.trial)) + 1;

  const bySystem = SYSTEMS.map((system) =>
    systemStats(system, runs.filter((r) => r.system === system)),
  ).filter((s) => s.runs > 0);

  // One MixStats row per (system × distinct mix), in stable order.
  const byMix: MixStats[] = [];
  for (const system of SYSTEMS) {
    const sysRuns = runs.filter((r) => r.system === system);
    const keys = [...new Set(sysRuns.map((r) => mixKey(r.modelMix)))].sort();
    for (const key of keys) {
      const cell = sysRuns.filter((r) => mixKey(r.modelMix) === key);
      byMix.push(mixStats(system, cell[0].modelMix, cell));
    }
  }

  const agg: Aggregate = {
    totalRuns: runs.length,
    trials,
    bySystem,
    byMix,
    delta: computeDelta(runs),
  };

  if (trials > 1) agg.variance = computeVariance(runs, trials);
  return agg;
}
