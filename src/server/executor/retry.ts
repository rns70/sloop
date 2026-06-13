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

/**
 * FOUNDATION STUB: single attempt, no retry — preserves current behavior exactly.
 * Task 3 (Retry-with-evidence) replaces this body with the real attempt loop.
 */
export async function runLeafWithRetry(loop: LoopDoc, deps: RetryDeps): Promise<LeafRunResult> {
  await deps.executeAttempt(loop, { priorEvidence: [] });
  const ok = await deps.verify(loop);
  return { ok, attempts: 1, evidence: [] };
}
