import type { LoopDoc } from '../../shared/types';
import type { ExecuteAttempt } from './attempt';
import type { CriterionFailure, VerifyOutcome } from './verify';

/** Result of running a leaf to completion (across one or more attempts). */
export interface LeafRunResult {
  ok: boolean;
  attempts: number;
  evidence: string[];
}

export interface RetryDeps {
  executeAttempt: ExecuteAttempt;
  verify: (loop: LoopDoc) => Promise<VerifyOutcome>;
  maxAttempts: number;
  onOutput?: (chunk: string) => void;
}

/**
 * Format one verify failure into actionable evidence for the next attempt. Includes the
 * criterion text, the exact command, and its captured output — so the agent fixes the
 * real cause instead of guessing (which is what drove the blind retry loops).
 */
function formatFailure(attempt: number, f: CriterionFailure): string {
  const out = f.output.trim() ? `Command output:\n${f.output.trim()}` : 'Command produced no output.';
  return [
    `Attempt ${attempt} — criterion "${f.text}" FAILED.`,
    `Verify command (run from the workspace root): \`${f.command}\``,
    out,
  ].join('\n');
}

export async function runLeafWithRetry(loop: LoopDoc, deps: RetryDeps): Promise<LeafRunResult> {
  const evidence: string[] = [];

  for (let attempt = 1; attempt <= deps.maxAttempts; attempt++) {
    deps.onOutput?.(`\n[attempt ${attempt}/${deps.maxAttempts}] ${loop.frontmatter.id}\n`);
    const { violations } = await deps.executeAttempt(loop, { priorEvidence: [...evidence] });

    if (violations.length > 0) {
      const note = `Attempt ${attempt}: wrote files outside allowedOutputs: ${violations.join(', ')}.`;
      deps.onOutput?.(`[sandbox] ${note}\n`);
      evidence.push(note);
      continue; // out-of-bounds writes are a failure; don't even run verify
    }

    const { ok, failures } = await deps.verify(loop);
    if (ok) return { ok: true, attempts: attempt, evidence };
    if (failures.length === 0) {
      // ok=false with no captured failures shouldn't happen, but stay informative.
      evidence.push(`Attempt ${attempt}: acceptance criteria did not pass.`);
    } else {
      for (const f of failures) evidence.push(formatFailure(attempt, f));
    }
  }

  return { ok: false, attempts: deps.maxAttempts, evidence };
}
