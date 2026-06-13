import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  createAgentSession,
} from '@earendil-works/pi-coding-agent';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { LoopDoc, ResolvedModel } from '../../shared/types';
import { diffPathSets, gitDirtySet } from './captureWrites';
import { buildModel } from './piExecutor';
import { validateOutputs } from './sandbox';

/** One attempt's outcome: what the agent wrote and which writes were out of bounds. */
export interface AttemptResult {
  writtenFiles: string[];
  violations: string[];
}

/** Runs the Pi agent for one attempt. Foundation: no file capture yet (writtenFiles=[]). */
export type ExecuteAttempt = (loop: LoopDoc, opts: { priorEvidence: string[] }) => Promise<AttemptResult>;

/**
 * Compose the brief handed to the Pi agent: the leaf body, its acceptance criteria,
 * and (on retries) the evidence from prior failed attempts so the agent can correct.
 */
export function buildBrief(loop: LoopDoc, priorEvidence: string[] = []): string {
  const { acceptanceCriteria, allowedOutputs } = loop.frontmatter;
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

  if (allowedOutputs && allowedOutputs.length > 0) {
    sections.push(
      `## Allowed outputs\n\nYou may ONLY create or edit files matching these globs:\n` +
        allowedOutputs.map((g) => `- \`${g}\``).join('\n'),
    );
  }

  if (priorEvidence.length > 0) {
    sections.push(
      `## Previous attempt failed\n\nThe last attempt did not pass. Evidence:\n\n` +
        priorEvidence.join('\n\n') +
        `\n\nFix the cause and try again.`,
    );
  }

  sections.push(
    'Make the necessary changes to the codebase in this working directory. ' +
      'When finished, stop — the acceptance criteria will be checked automatically.',
  );

  return sections.filter(Boolean).join('\n\n');
}

export interface AttemptDeps {
  resolved: ResolvedModel;
  cwd: string;
  timeoutMs: number;
  onOutput: (chunk: string) => void;
}

/** Run the Pi coding agent for one attempt. (Moved verbatim from piExecutor.runPiAgent.) */
export async function runPiAgentOnce(loop: LoopDoc, deps: AttemptDeps, priorEvidence: string[]): Promise<void> {
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(deps.resolved.provider, deps.resolved.apiKey);
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = buildModel(deps.resolved);

  const { session } = await createAgentSession({
    cwd: deps.cwd,
    model,
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.inMemory(),
  });

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === 'message_update') {
      const inner = event.assistantMessageEvent;
      if (inner.type === 'text_delta') deps.onOutput(inner.delta);
    } else if (event.type === 'tool_execution_start') {
      deps.onOutput(`\n[tool] ${event.toolName}\n`);
    }
  });

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      void session.abort().finally(resolve);
    }, deps.timeoutMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });

  try {
    await Promise.race([session.prompt(buildBrief(loop, priorEvidence)), timeout]);
    if (timedOut) deps.onOutput(`\n[sloop] agent exceeded ${deps.timeoutMs}ms timeout — aborted.\n`);
  } finally {
    if (timer) clearTimeout(timer);
    unsubscribe();
  }
}

/**
 * Build the per-leaf attempt runner. Ensures the in-workspace `code/` target exists,
 * snapshots the working tree before/after the agent run, and captures the files the
 * attempt wrote via a git working-tree diff. Task 2's `validateOutputs` then turns
 * captured writes into violations.
 */
export function makeExecuteAttempt(ctx: {
  resolveAttemptDeps: (loop: LoopDoc) => AttemptDeps | null; // null = dry-run (skip agent)
}): ExecuteAttempt {
  return async (loop, { priorEvidence }) => {
    const deps = ctx.resolveAttemptDeps(loop);
    const cwd = deps?.cwd ?? process.cwd();
    await fs.mkdir(path.join(cwd, 'code'), { recursive: true }); // in-workspace target

    const before = await gitDirtySet(cwd);
    if (deps) await runPiAgentOnce(loop, deps, priorEvidence);
    const after = await gitDirtySet(cwd);

    const writtenFiles = diffPathSets(before, after);
    const violations = validateOutputs(writtenFiles, loop.frontmatter.allowedOutputs);
    return { writtenFiles, violations };
  };
}
