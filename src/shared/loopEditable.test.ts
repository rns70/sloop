import { describe, it, expect } from 'vitest';
import type { LoopStatus } from './types';
import { isLoopEditable, EDITABLE_LOOP_STATUSES } from './loopEditable';

describe('isLoopEditable', () => {
  it('is true for every pre-execution status', () => {
    expect(EDITABLE_LOOP_STATUSES).toEqual(['planned', 'awaiting_approval', 'queued']);
    for (const s of EDITABLE_LOOP_STATUSES) expect(isLoopEditable(s)).toBe(true);
  });

  it('is false once the loop has started or finished', () => {
    const frozen: LoopStatus[] = ['executing', 'blocked', 'review', 'done', 'failed'];
    for (const s of frozen) expect(isLoopEditable(s)).toBe(false);
  });
});
