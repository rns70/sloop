/**
 * Eval-harness domain types (WP-8).
 *
 * The headline contract is {@link RunResult} — one JSON object per
 * `(task × modelMix × system × trial)` run, written as a line to
 * `evals/results/<run-id>/runs.jsonl`. Its shape matches the eval design spec
 * §4 verbatim, plus the `system` and `trial` fields the handoff requires.
 *
 * All types here are pure data (no I/O), so `metrics.ts` aggregation stays
 * unit-testable on hand-built arrays.
 */

import type { ProviderName } from '../shared/index';

/** The two systems we compare head-to-head (spec §4). */
export type EvalSystem = 'sloop' | 'baseline-flat';

/** A planner/executor model pairing — the routing axis of the cost story. */
export interface ModelMix {
  /** Registry alias for the architect/planner model (big, expensive). */
  plan: string;
  /** Registry alias for leaf execution (cheap; the variable we sweep). */
  execute: string;
}

/** Per-model token + cost breakdown inside a single run. */
export interface ModelCost {
  usd: number;
  tokensIn: number;
  tokensOut: number;
}

/** Cost rollup for one run: totals plus a per-model breakdown (spec §4). */
export interface RunCost extends ModelCost {
  /** alias -> its share of this run's cost/tokens. */
  byModel: Record<string, ModelCost>;
}

/**
 * One eval run. `falsePositive === converged && !independentPass` — the honesty
 * check at the heart of the convergence claim (spec §1).
 */
export interface RunResult {
  taskId: string;
  system: EvalSystem;
  modelMix: ModelMix;
  /** 0-based trial index; >0 only when `--trials N` (N>1) is used (spec §10). */
  trial: number;
  /** sloop: root loop reached `done`. baseline: the agent reported complete. */
  converged: boolean;
  /** Every held-out command exited 0 (independent of what the agents claimed). */
  independentPass: boolean;
  /** `converged && !independentPass` — claimed done but the hidden suite failed. */
  falsePositive: boolean;
  criteria: {
    total: number;
    passedByAgent: number;
    passedIndependent: number;
  };
  tree: {
    loops: number;
    maxDepth: number;
  };
  cost: RunCost;
  latencyMs: number;
  /** Non-null when the run errored (timeout, kickoff failure, env error). */
  error: string | null;
}

/** A resolved (pinned) model the run actually used — for the self-describing header. */
export interface ResolvedModelInfo {
  alias: string;
  provider: ProviderName;
  id: string;
}

/**
 * Run-level metadata for `summary.md`'s self-describing header (spec §10): what
 * actually ran, so a run can be reproduced/compared even as registry aliases drift.
 */
export interface RunMeta {
  runId: string;
  /** ISO timestamp — passed in (never `Date.now()` in shared/aggregation code). */
  createdAt: string;
  /** Trials per (task × mix × system). */
  trials: number;
  /** Task ids that were run. */
  taskIds: string[];
  /** Resolved model pinning, keyed by alias. */
  resolvedModels: ResolvedModelInfo[];
  /** Whether this was a SLOOP_DRY_RUN (plumbing-only) pass — numbers are NOT real. */
  dryRun: boolean;
}

// ---- Tasks --------------------------------------------------------------

/** Source of a task — handmade markdown or a SWE-bench instance. */
export type TaskSource = 'handmade' | 'swebench';

/**
 * A loaded eval task (handmade or SWE-bench), normalized to one shape (spec §3).
 * `heldOut` commands are NEVER shown to the agents; `body` (with its agent-visible
 * `verify` criteria) is written to `adrPath` in the loops before the cascade runs.
 */
export interface EvalTask {
  id: string;
  source: TaskSource;
  /** Directory name under `evals/repos/` (handmade) or the prepared env id (swebench). */
  repo: string;
  /** Git ref to reset the target repo to before each run. */
  baseRef: string;
  /** Databank file the requirement is written to (e.g. `loops/adr-020-rate-limit.md`). */
  adrPath: string;
  /** Independent acceptance commands — run by the harness, hidden from agents. */
  heldOut: string[];
  /** The model mixes to run for this task. */
  modelMixes: ModelMix[];
  /** Requirement text + agent-visible criteria, written to `adrPath`. */
  body: string;
  /** Title for the ADR / requirement. */
  title: string;
  /**
   * SWE-bench only: how to reset + run held-out inside the prepared environment.
   * Absent for handmade tasks (which use a local git repo under `evals/repos/`).
   */
  swebench?: SwebenchEnv;
}

/** SWE-bench instance environment hooks (spec §8). */
export interface SwebenchEnv {
  instanceId: string;
  /** Docker image holding the prepared repo + deps (e.g. `swebench/sweb.eval.x86_64.<id>`). */
  image: string;
  /** Absolute path to the repo inside the image/container. */
  repoPathInImage: string;
}
