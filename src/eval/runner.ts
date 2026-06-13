/**
 * The eval runner (WP-8, eval spec §5) — orchestrates the matrix
 * `(task × modelMix × system × trial)` and writes one {@link RunResult} per run to
 * `runs.jsonl`. For each run it executes the §5 flow:
 *
 *   1. reset the target repo to baseRef (`git reset --hard && git clean -fd`)
 *   2. (sloop) set up a scratch workspace + write the requirement ADR (the databank diff)
 *   3. route models for the run (mix.plan / mix.execute)
 *   4. run the system — sloop: kickoff + AUTO-APPROVE, wait for the root loop to reach a
 *      terminal status (timeout → error); baseline-flat: one Pi agent, no decomposition
 *   5. converged = root `done` (sloop) / agent completed (baseline)
 *   6. independent check: run each held-out command (hidden from agents)
 *   7. collect cost (by model), tree size/depth, latency, criteria counts
 *   8. append the JSON line; reset the repo
 *
 * Pure orchestration + I/O; the math lives in metrics.ts and is reported by report.ts.
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CascadeEngine, LoopDoc, ModelRegistry } from '../shared/index';
import { createFilesService } from '../server/files/filesService';
import { runBaselineFlat } from './baseline';
import { UsageAccumulator, emptyCost, type RateCard } from './cost';
import { buildEvalEngine, isDryRun, resolveMix } from './engine';
import { appendRun } from './report';
import {
  applyRequirement,
  dockerAvailable,
  ensureHandmadeRepo,
  resetGitRepo,
  runHeldOutInDocker,
  runHeldOutLocal,
  setupWorkspace,
} from './repo';
import type {
  EvalSystem,
  EvalTask,
  ModelMix,
  ResolvedModelInfo,
  RunMeta,
  RunResult,
} from './types';

const exec = promisify(execFile);
const DEFAULT_CONVERGENCE_TIMEOUT_MS = 900_000; // 15 min ceiling per cascade

export interface RunnerOptions {
  runId: string;
  /** ISO timestamp for this run (passed in — not generated here; spec §10). */
  createdAt: string;
  trials: number;
  tasks: EvalTask[];
  systems: EvalSystem[];
  /** `evals/results/<runId>` — where runs.jsonl is written. */
  outDir: string;
  /** Directory containing the `.sloop/` template (registry/roles/templates). */
  workspaceTemplateDir: string;
  /** Root holding handmade target repos (`<reposRoot>/<task.repo>`). */
  reposRoot: string;
  /** Scratch root for per-run workspaces + swebench checkouts. Defaults to an OS temp dir. */
  scratchRoot?: string;
  env: NodeJS.ProcessEnv;
  rates?: Readonly<Record<string, RateCard>>;
  convergenceTimeoutMs?: number;
  /** Monotonic wall-clock for latency (ms). Injectable for tests; defaults to Date.now. */
  clock?: () => number;
  onLog?: (msg: string) => void;
}

interface TargetRepo {
  dir: string;
  reset: () => Promise<void>;
  runHeldOut: (cwd: string) => Promise<boolean>;
}

/** Walk the parent chain to find the deepest loop (architect=1, its leaves=2, …). */
function maxDepth(loops: readonly LoopDoc[]): number {
  const byId = new Map(loops.map((l) => [l.frontmatter.id, l]));
  const depthOf = (l: LoopDoc, seen: Set<string>): number => {
    const parent = l.frontmatter.parent;
    if (!parent || seen.has(l.frontmatter.id)) return 1;
    const p = byId.get(parent);
    if (!p) return 1;
    seen.add(l.frontmatter.id);
    return 1 + depthOf(p, seen);
  };
  return loops.reduce((m, l) => Math.max(m, depthOf(l, new Set())), loops.length > 0 ? 1 : 0);
}

/** Count acceptance criteria across the tree and how many the agent marked passed. */
function criteriaCounts(loops: readonly LoopDoc[]): { total: number; passedByAgent: number } {
  let total = 0;
  let passedByAgent = 0;
  for (const l of loops) {
    for (const c of l.frontmatter.acceptanceCriteria) {
      total += 1;
      if (c.passed) passedByAgent += 1;
    }
  }
  return { total, passedByAgent };
}

/** Race a promise against a timeout; resolves to `'timeout'` if it overruns. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Prepare the target repo for a task and return its working directory + a reset and a
 * held-out runner closed over the right backend. Handmade tasks use the local repo under
 * `reposRoot`; SWE-bench tasks copy the prepared image's repo into scratch (so the agent
 * edits locally and held-out runs in a container over those edits).
 */
async function prepareTarget(
  task: EvalTask,
  opts: RunnerOptions,
  scratchRoot: string,
): Promise<TargetRepo> {
  if (!task.swebench) {
    const dir = path.join(opts.reposRoot, task.repo);
    await ensureHandmadeRepo(dir, task.baseRef);
    return {
      dir,
      reset: () => resetGitRepo(dir, task.baseRef),
      runHeldOut: async (cwd) => (await runHeldOutLocal(task.heldOut, cwd, opts.env)).pass,
    };
  }

  if (isDryRun(opts.env)) {
    // Dry-run is plumbing-only — never pull multi-GB images or touch docker.
    throw new Error(`SWE-bench task "${task.id}" skipped in SLOOP_DRY_RUN (no docker/images needed).`);
  }
  if (!(await dockerAvailable())) {
    throw new Error(
      `SWE-bench task "${task.id}" needs docker (image ${task.swebench.image}); docker not found.`,
    );
  }
  const dir = path.join(scratchRoot, `swebench-${task.id}`);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(dir), { recursive: true });
  const name = `sloop-eval-${task.id}`.replace(/[^a-zA-Z0-9_.-]/g, '-');
  await exec('docker', ['rm', '-f', name]).catch(() => {});
  await exec('docker', ['create', '--name', name, task.swebench.image]);
  try {
    await exec('docker', ['cp', `${name}:${task.swebench.repoPathInImage}/.`, dir]);
  } finally {
    await exec('docker', ['rm', '-f', name]).catch(() => {});
  }
  return {
    dir,
    reset: () => resetGitRepo(dir, task.baseRef),
    runHeldOut: async () => (await runHeldOutInDocker(task, task.heldOut)).pass,
  };
}

/** Kick off a cascade, auto-approve, and return the terminal root status + loops. */
async function driveCascade(engine: CascadeEngine): Promise<{ status: string; loops: LoopDoc[] }> {
  const summary = await engine.kickoff('spec-driven');
  await engine.approve(summary.id); // AUTO-APPROVE — the eval-mode checkpoint bypass (§7.1)
  const got = await engine.get(summary.id);
  return { status: got.summary.status, loops: got.loops };
}

async function runOne(
  task: EvalTask,
  mix: ModelMix,
  system: EvalSystem,
  trial: number,
  registry: ModelRegistry,
  target: TargetRepo,
  opts: RunnerOptions,
  scratchRoot: string,
): Promise<{ run: RunResult; infos: ResolvedModelInfo[] }> {
  const clock = opts.clock ?? (() => Date.now());
  const timeoutMs = opts.convergenceTimeoutMs ?? DEFAULT_CONVERGENCE_TIMEOUT_MS;
  const log = opts.onLog ?? (() => {});
  const env = { ...opts.env, SLOOP_TARGET_REPO: target.dir };

  let converged = false;
  let error: string | null = null;
  let cost = emptyCost();
  let tree = { loops: system === 'sloop' ? 0 : 1, maxDepth: system === 'sloop' ? 0 : 1 };
  const criteria = { total: 0, passedByAgent: 0, passedIndependent: 0 };
  const infos = resolveMix(mix, registry, env).infos;

  const start = clock();
  try {
    await target.reset();

    if (system === 'sloop') {
      const workspaceDir = path.join(
        scratchRoot,
        `ws-${task.id}-${mix.plan}-${mix.execute}-${trial}`,
      );
      await setupWorkspace(workspaceDir, opts.workspaceTemplateDir);
      await applyRequirement(workspaceDir, task);

      const handle = buildEvalEngine({
        workspaceDir,
        targetRepoDir: target.dir,
        mix,
        registry,
        baseEnv: env,
        now: () => opts.createdAt,
        rates: opts.rates,
      });

      const result = await withTimeout(driveCascade(handle.engine), timeoutMs);
      cost = handle.usage.total();
      if (result === 'timeout') {
        error = `cascade exceeded ${timeoutMs}ms`;
      } else {
        converged = result.status === 'done';
        tree = { loops: result.loops.length, maxDepth: maxDepth(result.loops) };
        const cc = criteriaCounts(result.loops);
        criteria.total = cc.total;
        criteria.passedByAgent = cc.passedByAgent;
      }
    } else {
      const { execute } = resolveMix(mix, registry, env);
      const usage = new UsageAccumulator(opts.rates);
      const res = await withTimeout(
        runBaselineFlat({
          task,
          resolvedExecute: execute,
          executeAlias: mix.execute,
          targetRepoDir: target.dir,
          usage,
          env,
        }),
        timeoutMs,
      );
      cost = usage.total();
      if (res === 'timeout') error = `baseline agent exceeded ${timeoutMs}ms`;
      else converged = res.completed;
    }

    // Independent held-out check (hidden from the agents).
    const independentPass = error ? false : await target.runHeldOut(target.dir);
    criteria.passedIndependent = independentPass ? criteria.total : 0;
    const latencyMs = clock() - start;

    const run: RunResult = {
      taskId: task.id,
      system,
      modelMix: mix,
      trial,
      converged,
      independentPass,
      falsePositive: converged && !independentPass,
      criteria,
      tree,
      cost,
      latencyMs,
      error,
    };
    return { run, infos };
  } catch (err) {
    const latencyMs = clock() - start;
    error = (err as Error).message;
    log(`  ! ${task.id} ${system} ${mix.plan}->${mix.execute} errored: ${error}`);
    const run: RunResult = {
      taskId: task.id,
      system,
      modelMix: mix,
      trial,
      converged: false,
      independentPass: false,
      falsePositive: false,
      criteria,
      tree,
      cost,
      latencyMs,
      error,
    };
    return { run, infos };
  }
}

/**
 * Run the full matrix and write `runs.jsonl` incrementally (so a crash mid-matrix still
 * leaves a partial, readable record). Returns the runs + the self-describing {@link RunMeta}.
 */
export async function runMatrix(opts: RunnerOptions): Promise<{ runs: RunResult[]; meta: RunMeta }> {
  const log = opts.onLog ?? (() => {});
  const scratchRoot =
    opts.scratchRoot ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'sloop-eval-work-')));
  const jsonl = path.join(opts.outDir, 'runs.jsonl');
  const dry = isDryRun(opts.env);

  // The registry is shared across runs (read once from the template workspace).
  const registry = await createFilesService(opts.workspaceTemplateDir).readModelRegistry();

  // Dry-run resolves models (for infos + executor construction) but never calls them;
  // inject placeholder keys for any provider missing one so resolveModel doesn't fail
  // fast offline. Real runs keep the strict requirement (no placeholders).
  const env: NodeJS.ProcessEnv = { ...opts.env };
  if (dry) {
    for (const provider of Object.values(registry.providers)) {
      if (provider?.apiKeyEnv) env[provider.apiKeyEnv] ??= 'sk-dry-run-placeholder';
    }
  }
  const effectiveOpts: RunnerOptions = { ...opts, env };

  const runs: RunResult[] = [];
  const resolvedModels = new Map<string, ResolvedModelInfo>();

  for (const task of opts.tasks) {
    let target: TargetRepo;
    try {
      target = await prepareTarget(task, effectiveOpts, scratchRoot);
    } catch (err) {
      log(`! skipping task ${task.id}: ${(err as Error).message}`);
      continue;
    }

    for (const mix of task.modelMixes) {
      for (const system of opts.systems) {
        for (let trial = 0; trial < opts.trials; trial++) {
          log(
            `▶ ${task.id} | ${system} | ${mix.plan}->${mix.execute} | trial ${trial}${dry ? ' (dry)' : ''}`,
          );
          const { run, infos } = await runOne(
            task,
            mix,
            system,
            trial,
            registry,
            target,
            effectiveOpts,
            scratchRoot,
          );
          for (const info of infos) resolvedModels.set(info.alias, info);
          await appendRun(jsonl, run);
          runs.push(run);
          log(
            `  = converged=${run.converged} independentPass=${run.independentPass} ` +
              `cost=$${run.cost.usd.toFixed(4)} ${run.error ? `error="${run.error}"` : ''}`,
          );
        }
      }
    }
  }

  const meta: RunMeta = {
    runId: opts.runId,
    createdAt: opts.createdAt,
    trials: opts.trials,
    // Tasks that actually produced runs (skipped tasks — e.g. swebench without docker — excluded).
    taskIds: [...new Set(runs.map((r) => r.taskId))],
    resolvedModels: [...resolvedModels.values()],
    dryRun: dry,
  };
  return { runs, meta };
}
