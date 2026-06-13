import type { Api, Model } from '@earendil-works/pi-ai';
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  createAgentSession,
  type AgentSessionEvent,
} from '@earendil-works/pi-coding-agent';

import type { Executor } from '../../shared/services';
import type { LoopDoc, ResolvedModel } from '../../shared/types';
import { runVerify } from './verify';

/** Default ceiling for a single leaf's agent run. Overridable via SLOOP_EXECUTOR_TIMEOUT_MS. */
export const DEFAULT_EXECUTOR_TIMEOUT_MS = 600_000;

/** Anthropic's public API base, used when the registry doesn't pin one. */
const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com';

/** Map a sloop provider onto the pi-ai API implementation it speaks. */
const PROVIDER_API: Record<ResolvedModel['provider'], Api> = {
  anthropic: 'anthropic-messages',
  nebius: 'openai-completions',
};

function isDryRun(env: NodeJS.ProcessEnv): boolean {
  const raw = env.SLOOP_DRY_RUN;
  if (!raw) return false;
  const v = raw.toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no' && v !== 'off';
}

function resolveTargetRepo(env: NodeJS.ProcessEnv): string {
  return env.SLOOP_TARGET_REPO || process.cwd();
}

function resolveExecutorTimeoutMs(env: NodeJS.ProcessEnv): number {
  const raw = env.SLOOP_EXECUTOR_TIMEOUT_MS;
  if (!raw) return DEFAULT_EXECUTOR_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_EXECUTOR_TIMEOUT_MS;
}

/**
 * Build a concrete pi-ai `Model` from a resolved registry entry — provider-agnostic.
 * The same shape covers Anthropic (`anthropic-messages`) and Nebius/Nemotron and any
 * other OpenAI-compatible provider (`openai-completions`); only the API id, baseUrl,
 * and provider key differ. Cost/context/token fields are placeholders: they drive
 * accounting/telemetry, not request correctness, and sloop doesn't bill off them yet.
 */
export function buildModel(resolved: ResolvedModel): Model<Api> {
  const api = PROVIDER_API[resolved.provider];
  const baseUrl =
    resolved.baseUrl ?? (resolved.provider === 'anthropic' ? ANTHROPIC_DEFAULT_BASE_URL : '');

  if (!baseUrl) {
    // Fail fast: an OpenAI-compatible provider with no baseUrl can't be reached.
    throw new Error(
      `Model "${resolved.id}" (provider "${resolved.provider}") has no baseUrl; ` +
        'set providers.<name>.baseUrl in the registry.',
    );
  }

  return {
    id: resolved.id,
    name: resolved.id,
    api,
    provider: resolved.provider,
    baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 8_192,
  };
}

/**
 * Compose the brief handed to the Pi agent from the leaf's body and its acceptance
 * criteria. The criteria are the contract the agent is working toward, so they're
 * spelled out explicitly — the same ones we then verify by command.
 */
export function buildBrief(loop: LoopDoc): string {
  const { acceptanceCriteria } = loop.frontmatter;
  const sections = [loop.body.trim()];

  if (acceptanceCriteria.length > 0) {
    const lines = acceptanceCriteria.map((c) => {
      const verifyNote = c.verify ? `  (verified by: \`${c.verify}\`)` : '';
      return `- ${c.text}${verifyNote}`;
    });
    sections.push(
      `## Acceptance criteria\n\nYour work is done when all of these hold:\n${lines.join('\n')}`,
    );
  }

  sections.push(
    'Make the necessary changes to the codebase in this working directory. ' +
      'When finished, stop — the acceptance criteria will be checked automatically.',
  );

  return sections.filter(Boolean).join('\n\n');
}

/**
 * Run the Pi coding agent for a leaf against the target repo, forwarding streamed
 * assistant text and tool activity to `onOutput`. Bounded by an overall timeout
 * (the agent is aborted if it overruns). Throws on agent construction/run failure
 * so the caller can mark the leaf blocked.
 */
async function runPiAgent(
  loop: LoopDoc,
  resolved: ResolvedModel,
  cwd: string,
  timeoutMs: number,
  onOutput: (chunk: string) => void,
): Promise<void> {
  const authStorage = AuthStorage.inMemory();
  // Inject the already-resolved key as a runtime override keyed by provider name —
  // no disk auth.json, no env probing, works the same for every provider.
  authStorage.setRuntimeApiKey(resolved.provider, resolved.apiKey);

  const modelRegistry = ModelRegistry.create(authStorage);
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
    } else if (event.type === 'tool_execution_start') {
      onOutput(`\n[tool] ${event.toolName}\n`);
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

  try {
    await Promise.race([session.prompt(buildBrief(loop)), timeout]);
    if (timedOut) {
      onOutput(`\n[sloop] agent exceeded ${timeoutMs}ms timeout — aborted.\n`);
    }
  } finally {
    if (timer) clearTimeout(timer);
    unsubscribe();
  }
}

/**
 * Run all acceptance criteria that carry a `verify` command, mutating each one's
 * `passed` flag in place. Criteria without a command are skipped (Phase-2 QA
 * adjudication — spec §3). Returns whether every *verified* criterion passed; a
 * leaf with no verifiable criteria is vacuously ok.
 */
async function verifyCriteria(
  loop: LoopDoc,
  cwd: string,
  env: NodeJS.ProcessEnv,
  onOutput: (chunk: string) => void,
): Promise<boolean> {
  let allPassed = true;
  let verified = 0;

  for (const criterion of loop.frontmatter.acceptanceCriteria) {
    if (!criterion.verify) continue;
    verified += 1;
    onOutput(`\n[verify] ${criterion.id}: ${criterion.verify}\n`);
    const passed = await runVerify(criterion.verify, cwd, { env });
    criterion.passed = passed;
    if (!passed) allPassed = false;
    onOutput(`[verify] ${criterion.id}: ${passed ? 'PASS' : 'FAIL'}\n`);
  }

  if (verified === 0) {
    onOutput('\n[verify] no criteria with a verify command — nothing to check.\n');
  }
  return allPassed;
}

/**
 * The single, provider-agnostic Executor. Wraps a Pi coding agent: runs it against
 * the target repo for a leaf, streams its output, then runs each criterion's verify
 * command to decide pass/fail.
 *
 * `SLOOP_DRY_RUN` skips the agent entirely and only runs the verify commands — the
 * safety valve for offline / cost-free demos (spec §9, handoff).
 *
 * Env vars:
 *   - SLOOP_TARGET_REPO         target repo root (default: process.cwd())
 *   - SLOOP_DRY_RUN             skip the Pi agent, only verify (truthy; 0/false/no/off = off)
 *   - SLOOP_EXECUTOR_TIMEOUT_MS overall agent timeout (default 600000)
 *   - SLOOP_VERIFY_TIMEOUT_MS   per-criterion verify timeout (default 120000)
 */
/**
 * Resolve the concrete model (provider + id + key) a given leaf runs on. Called once per
 * leaf, at run time — never at construction. This is what makes a missing key a per-leaf
 * failure (the leaf is marked blocked) instead of a fatal boot crash, and lets each leaf
 * run on its own planned provider so Anthropic and Nebius keys are interchangeable per leaf.
 */
export type ResolveLeafModel = (loop: LoopDoc) => ResolvedModel;

export function createExecutor(resolveLeafModel: ResolveLeafModel): Executor {
  return {
    async run(loop, onOutput) {
      const env = process.env;
      const cwd = resolveTargetRepo(env);

      if (isDryRun(env)) {
        onOutput('[sloop] SLOOP_DRY_RUN — skipping Pi agent, running verify only.\n');
      } else {
        // Resolve lazily: a leaf whose provider key is missing throws here and is marked
        // blocked by the caller, rather than taking the whole server down at startup.
        const resolved = resolveLeafModel(loop);
        const timeoutMs = resolveExecutorTimeoutMs(env);
        await runPiAgent(loop, resolved, cwd, timeoutMs, onOutput);
      }

      const ok = await verifyCriteria(loop, cwd, env, onOutput);
      return { ok };
    },
  };
}
