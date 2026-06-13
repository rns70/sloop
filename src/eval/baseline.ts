/**
 * baseline-flat system (WP-8, eval spec §4–§5): one Pi coding agent handed the same
 * requirement + repo as sloop, with NO decomposition, routing, or convergence invariant.
 *
 * This is the head-to-head control. Same task, same held-out tests, same execute model
 * → the sloop-vs-baseline delta isolates what sloop's orchestration actually buys. The
 * runner runs the held-out suite independently afterward (this module only drives the
 * single agent and reports whether it completed).
 *
 * `convergence` here = "the agent ran to completion without erroring/timing out" — the
 * baseline has no tree to bubble status up, so completion is the only self-reported signal.
 */

import {
  AuthStorage,
  ModelRegistry as PiModelRegistry,
  SessionManager,
  createAgentSession,
  type AgentSessionEvent,
} from '@earendil-works/pi-coding-agent';
import { buildModel } from '../server/executor/piExecutor';
import type { ResolvedModel } from '../shared/index';
import type { UsageAccumulator } from './cost';
import { isDryRun } from './engine';
import type { EvalTask } from './types';

/** Compose the single-agent brief from the task requirement (the whole job, undivided). */
export function buildBaselineBrief(task: EvalTask): string {
  return [
    `# Task: ${task.title}`,
    '',
    task.body.trim(),
    '',
    'Make all necessary changes to the codebase in this working directory to satisfy the',
    'requirement above. When finished, stop — your work will be checked automatically.',
  ].join('\n');
}

/**
 * Run the baseline: a single Pi agent on `resolvedExecute` against `targetRepoDir`.
 * Records token usage under `executeAlias`. Returns `{ completed }` — true if the agent
 * finished without error/timeout (dry-run completes trivially). Never throws on agent
 * failure; a crash/timeout is reported as `completed: false`.
 */
export async function runBaselineFlat(opts: {
  task: EvalTask;
  resolvedExecute: ResolvedModel;
  executeAlias: string;
  targetRepoDir: string;
  usage: UsageAccumulator;
  env: NodeJS.ProcessEnv;
  timeoutMs?: number;
  onOutput?: (chunk: string) => void;
}): Promise<{ completed: boolean }> {
  const { task, resolvedExecute, executeAlias, targetRepoDir, usage, env } = opts;
  const onOutput = opts.onOutput ?? (() => {});
  const timeoutMs = opts.timeoutMs ?? 600_000;

  if (isDryRun(env)) {
    onOutput('[sloop:eval:baseline] SLOOP_DRY_RUN — skipping Pi agent.\n');
    return { completed: true };
  }

  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(resolvedExecute.provider, resolvedExecute.apiKey);
  const modelRegistry = PiModelRegistry.create(authStorage);
  const model = buildModel(resolvedExecute);

  let session: Awaited<ReturnType<typeof createAgentSession>>['session'];
  try {
    ({ session } = await createAgentSession({
      cwd: targetRepoDir,
      model,
      authStorage,
      modelRegistry,
      sessionManager: SessionManager.inMemory(),
    }));
  } catch (err) {
    onOutput(`\n[sloop:eval:baseline] agent construction failed: ${(err as Error).message}\n`);
    return { completed: false };
  }

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === 'message_update') {
      const inner = event.assistantMessageEvent;
      if (inner.type === 'text_delta') onOutput(inner.delta);
    }
  });

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      void session.abort().finally(resolve);
    }, timeoutMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });

  let completed = false;
  try {
    await Promise.race([session.prompt(buildBaselineBrief(task)), timeout]);
    completed = !timedOut;
  } catch (err) {
    onOutput(`\n[sloop:eval:baseline] agent run failed: ${(err as Error).message}\n`);
    completed = false;
  } finally {
    if (timer) clearTimeout(timer);
    unsubscribe();
    try {
      const stats = session.getSessionStats();
      usage.record(executeAlias, { input: stats.tokens.input, output: stats.tokens.output });
    } catch {
      /* usage unavailable — degrade to $0, never crash */
    }
  }

  return { completed };
}
