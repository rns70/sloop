import type { LoopDoc } from '../../shared/types';
import type { ExecuteAttempt } from './attempt';

/** Result of running a leaf to completion (across one or more attempts). */
export interface LeafRunResult {
  ok: boolean;
  attempts: number;
  evidence: string[];
}

export interface RetryDeps {
  executeAttempt: ExecuteAttempt;
  verify: (loop: LoopDoc) => Promise<boolean>;
  maxAttempts: number;
  onOutput?: (chunk: string) => void;
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

    const ok = await deps.verify(loop);
    if (ok) return { ok: true, attempts: attempt, evidence };
    evidence.push(`Attempt ${attempt}: acceptance criteria did not pass (see verify output above).`);
  }

  return { ok: false, attempts: deps.maxAttempts, evidence };
}
