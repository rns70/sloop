/**
 * Eval engine wiring (WP-8) — constructs the REAL `CascadeEngine` (as WP-6 would) and
 * instruments it for the three integration points the eval design needs (spec §7),
 * WITHOUT editing any WP-2/WP-3 source:
 *
 *  1. Auto-approve   — the runner calls `engine.approve()` directly after `kickoff()`
 *                      (no human checkpoint). Lives in the runner, not here.
 *  2. Model override — planner via `SLOOP_PLANNER_MODEL=<mix.plan>` (the architect's
 *                      own hook); executor forced onto `<mix.execute>` for EVERY leaf by
 *                      constructing the executor with that one resolved model — the
 *                      "execute-default override" the handoff asks for.
 *  3. Usage capture  — a custom planner `call` records the planner message's pi-ai
 *                      `usage`; the eval executor records `session.getSessionStats()`
 *                      tokens. Both feed one {@link UsageAccumulator} per run.
 *
 * `SLOOP_DRY_RUN` short-circuits every model call (planner returns a canned trivial
 * plan; executor skips the agent) so plumbing can be smoke-tested offline (spec §9).
 */

import { complete, type Api, type Context, type Model } from '@earendil-works/pi-ai';
import {
  AuthStorage,
  ModelRegistry as PiModelRegistry,
  SessionManager,
  createAgentSession,
  type AgentSessionEvent,
} from '@earendil-works/pi-coding-agent';

import { createCascadeEngine } from '../server/cascade/cascadeEngine';
import { createFilesService } from '../server/files/filesService';
import { createGitService } from '../server/git/gitService';
import { buildBrief, buildModel } from '../server/executor/piExecutor';
import { runVerify } from '../server/executor/verify';
import { type ArchitectModelCall, createArchitect, toPiModel } from '../server/planner/architect';
import { resolveModel } from '../shared/index';
import type {
  CascadeEngine,
  Executor,
  LoopDoc,
  ModelRegistry,
  ResolvedModel,
} from '../shared/index';
import { type RateCard, UsageAccumulator } from './cost';
import type { ModelMix, ResolvedModelInfo } from './types';

/** Read SLOOP_DRY_RUN as a boolean (0/false/no/off ⇒ off), mirroring piExecutor. */
export function isDryRun(env: NodeJS.ProcessEnv): boolean {
  const raw = env.SLOOP_DRY_RUN;
  if (!raw) return false;
  const v = raw.toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no' && v !== 'off';
}

/** Extract concatenated text from a pi-ai assistant message. */
function textFromMessage(message: { content: Array<{ type: string }> }): string {
  return message.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

export interface ResolvedMix {
  plan: ResolvedModel;
  execute: ResolvedModel;
  /** For the summary header pinning (deduped by the caller). */
  infos: ResolvedModelInfo[];
}

/** Resolve a mix's plan + execute aliases against the registry/env (fail-fast on missing keys). */
export function resolveMix(mix: ModelMix, registry: ModelRegistry, env: NodeJS.ProcessEnv): ResolvedMix {
  const plan = resolveModel(mix.plan, registry, env);
  const execute = resolveModel(mix.execute, registry, env);
  return {
    plan,
    execute,
    infos: [
      { alias: mix.plan, provider: plan.provider, id: plan.id },
      { alias: mix.execute, provider: execute.provider, id: execute.id },
    ],
  };
}

/** A canned, always-valid architect plan for dry-run plumbing (one vacuous leaf). */
function dryRunPlanJson(executeAlias: string): string {
  return JSON.stringify({
    summary: 'SLOOP_DRY_RUN canned plan (one leaf, no criteria — converges vacuously).',
    leaves: [
      {
        id: 'dry-run-leaf',
        role: 'engineer',
        model: executeAlias,
        brief: 'Dry-run: no real work performed; plumbing only.',
        acceptanceCriteria: [],
      },
    ],
  });
}

/**
 * Build a planner `call` that (a) honors dry-run by returning a canned plan, and
 * (b) records the planner's token usage under the plan alias.
 */
function makePlannerCall(
  planAlias: string,
  usage: UsageAccumulator,
  env: NodeJS.ProcessEnv,
): ArchitectModelCall {
  const dry = isDryRun(env);
  return async (resolved, parts) => {
    if (dry) return dryRunPlanJson(env.SLOOP_EXECUTE_ALIAS ?? 'haiku');

    const model: Model<Api> = toPiModel(resolved);
    const context: Context = {
      systemPrompt: parts.systemPrompt,
      messages: [{ role: 'user', content: parts.userPrompt, timestamp: 0 }],
    };
    const message = await complete(model, context, { apiKey: resolved.apiKey, maxTokens: 4_096 });
    usage.record(planAlias, message.usage);

    const text = textFromMessage(message);
    if (!text) throw new Error(`Planner "${resolved.id}" returned no text (${message.stopReason}).`);
    return text;
  };
}

/**
 * The eval executor: forces every leaf onto the run's single `execute` model (the
 * per-run override), runs the Pi coding agent against `targetRepoDir`, records the
 * session's token usage, then runs each criterion's `verify` command. In dry-run the
 * agent is skipped and only verify runs. Errors during the agent run mark the leaf
 * failed (return `{ ok: false }`) rather than throwing, so one bad leaf doesn't abort
 * the whole cascade silently — the convergence invariant surfaces it as `blocked`.
 */
export function createEvalExecutor(opts: {
  resolved: ResolvedModel;
  executeAlias: string;
  targetRepoDir: string;
  usage: UsageAccumulator;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
}): Executor {
  const { resolved, executeAlias, targetRepoDir, usage, env } = opts;
  const dry = isDryRun(env);
  const timeoutMs = opts.timeoutMs ?? 600_000;

  return {
    async run(loop: LoopDoc, onOutput: (chunk: string) => void): Promise<{ ok: boolean }> {
      if (!dry) {
        try {
          await runAgentCapturingUsage(
            loop,
            resolved,
            executeAlias,
            targetRepoDir,
            timeoutMs,
            usage,
            onOutput,
          );
        } catch (err) {
          onOutput(`\n[sloop:eval] agent error: ${(err as Error).message}\n`);
          return { ok: false };
        }
      } else {
        onOutput('[sloop:eval] SLOOP_DRY_RUN — skipping Pi agent, running verify only.\n');
      }

      let allPassed = true;
      for (const criterion of loop.frontmatter.acceptanceCriteria) {
        if (!criterion.verify) continue;
        const passed = await runVerify(criterion.verify, targetRepoDir, { env });
        criterion.passed = passed;
        if (!passed) allPassed = false;
        onOutput(`[verify] ${criterion.id}: ${passed ? 'PASS' : 'FAIL'}\n`);
      }
      return { ok: allPassed };
    },
  };
}

/** Run the Pi agent for one leaf and add its session token usage to the accumulator. */
async function runAgentCapturingUsage(
  loop: LoopDoc,
  resolved: ResolvedModel,
  executeAlias: string,
  cwd: string,
  timeoutMs: number,
  usage: UsageAccumulator,
  onOutput: (chunk: string) => void,
): Promise<void> {
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(resolved.provider, resolved.apiKey);
  const modelRegistry = PiModelRegistry.create(authStorage);
  const model = buildModel(resolved);

  const { session } = await createAgentSession({
    cwd,
    model,
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.inMemory(),
  });

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === 'message_update') {
      const inner = event.assistantMessageEvent;
      if (inner.type === 'text_delta') onOutput(inner.delta);
    }
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => void session.abort().finally(resolve), timeoutMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });

  try {
    await Promise.race([session.prompt(buildBrief(loop)), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    unsubscribe();
    // Capture cumulative session token usage (input/output) under the execute alias.
    try {
      const stats = session.getSessionStats();
      usage.record(executeAlias, { input: stats.tokens.input, output: stats.tokens.output });
    } catch {
      // getSessionStats unavailable on some builds — degrade to $0 for this leaf, never crash.
    }
  }
}

export interface EvalEngineHandle {
  engine: CascadeEngine;
  /** The run's usage accumulator — sum into RunResult.cost after the cascade finishes. */
  usage: UsageAccumulator;
  /** Resolved model pinning for the summary header. */
  infos: ResolvedModelInfo[];
}

/**
 * Construct a fully-wired eval engine for one (workspace × target repo × mix) run.
 * The returned `engine` is the real `CascadeEngine`; `usage` accumulates planner +
 * executor tokens for cost reporting.
 */
export function buildEvalEngine(opts: {
  workspaceDir: string;
  targetRepoDir: string;
  mix: ModelMix;
  registry: ModelRegistry;
  baseEnv: NodeJS.ProcessEnv;
  now: () => string;
  rates?: Readonly<Record<string, RateCard>>;
  onOutput?: (loopId: string, chunk: string) => void;
}): EvalEngineHandle {
  const { workspaceDir, targetRepoDir, mix, registry, baseEnv, now } = opts;

  // Per-run env: route the planner to mix.plan; stash the execute alias for dry-run.
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    SLOOP_PLANNER_MODEL: mix.plan,
    SLOOP_EXECUTE_ALIAS: mix.execute,
  };

  const { execute, infos } = resolveMix(mix, registry, env);
  const usage = new UsageAccumulator(opts.rates);

  const files = createFilesService(workspaceDir);
  const git = createGitService(workspaceDir);
  const planner = createArchitect({ files, env, call: makePlannerCall(mix.plan, usage, env) });

  const executor = createEvalExecutor({
    resolved: execute,
    executeAlias: mix.execute,
    targetRepoDir,
    usage,
    env,
  });

  const engine = createCascadeEngine({
    files,
    git,
    executor,
    planner,
    env,
    now,
    onOutput: opts.onOutput,
  });

  return { engine, usage, infos };
}
