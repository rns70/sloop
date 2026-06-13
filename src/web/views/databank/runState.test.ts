/**
 * Tests for the ADR run-panel event reducer. Like the assistant's `applyEvent`, the
 * accumulation logic is a pure reducer so it can be verified without a DOM/React env
 * (jsdom is not configured — see vitest.config.ts). The RunPanel component is a thin
 * wrapper that feeds AdrRunEvents through `applyRunEvent` and renders the snapshot; this
 * covers the Run-button behaviour's observable contract: streamed status + output land
 * on the right ADR, criteria results are recorded, and the run reaches a terminal outcome.
 */
import { describe, expect, it } from 'vitest';
import type { AdrRunEvent } from '../../api-client/index';
import { applyRunEvent, initialRunSnapshot, type RunSnapshot } from './runState';

const ROOT = 'loops/auth/login.md';
const CHILD = 'loops/auth/session.md';

function fold(events: AdrRunEvent[], seed: RunSnapshot = initialRunSnapshot()): RunSnapshot {
  return events.reduce(applyRunEvent, seed);
}

describe('initialRunSnapshot', () => {
  it('seeds every run-set ADR as running so the subtree shows before events arrive', () => {
    const snap = initialRunSnapshot([ROOT, CHILD]);
    expect(snap.order).toEqual([ROOT, CHILD]);
    expect(snap.byPath[ROOT].status).toBe('running');
    expect(snap.byPath[CHILD].status).toBe('running');
    expect(snap.outcome).toBeNull();
    expect(snap.error).toBeNull();
  });
});

describe('applyRunEvent', () => {
  it('records a status transition for the named ADR', () => {
    const snap = fold([{ type: 'status', relPath: ROOT, status: 'evaluating' }]);
    expect(snap.byPath[ROOT].status).toBe('evaluating');
  });

  it('accumulates streamed output chunks in arrival order, per ADR', () => {
    const snap = fold([
      { type: 'output', relPath: ROOT, chunk: 'editing ' },
      { type: 'output', relPath: ROOT, chunk: 'files…' },
      { type: 'output', relPath: CHILD, chunk: 'verifying' },
    ]);
    expect(snap.byPath[ROOT].output).toBe('editing files…');
    expect(snap.byPath[CHILD].output).toBe('verifying');
  });

  it('lazily tracks an ADR not present in the seed (first event grows order)', () => {
    const snap = fold([{ type: 'output', relPath: CHILD, chunk: 'hi' }]);
    expect(snap.order).toEqual([CHILD]);
    expect(snap.byPath[CHILD].output).toBe('hi');
  });

  it('records per-criterion eval results, latest wins', () => {
    const snap = fold([
      { type: 'eval', relPath: ROOT, criterionId: 'ac-1', passed: false },
      { type: 'eval', relPath: ROOT, criterionId: 'ac-2', passed: true },
      { type: 'eval', relPath: ROOT, criterionId: 'ac-1', passed: true },
    ]);
    expect(snap.byPath[ROOT].criteria).toEqual({ 'ac-1': true, 'ac-2': true });
  });

  it('captures the overall outcome on done without clobbering per-ADR status', () => {
    const snap = fold([
      { type: 'status', relPath: ROOT, status: 'passed' },
      { type: 'done', runId: 'r1', status: 'passed' },
    ]);
    expect(snap.outcome).toBe('passed');
    expect(snap.byPath[ROOT].status).toBe('passed');
  });

  it('surfaces a terminal error message', () => {
    const snap = fold([{ type: 'error', message: 'agent crashed' }]);
    expect(snap.error).toBe('agent crashed');
  });

  it('returns a new snapshot object (immutable) so a watching render re-runs', () => {
    const before = initialRunSnapshot([ROOT]);
    const after = applyRunEvent(before, { type: 'output', relPath: ROOT, chunk: 'x' });
    expect(after).not.toBe(before);
    expect(before.byPath[ROOT].output).toBe(''); // input untouched
  });
});
