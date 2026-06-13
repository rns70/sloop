/**
 * Tests for the assistant write-signal logic using the pure-reducer approach
 * (no renderHook: @testing-library/react / jsdom are not configured — see
 * useAssistantChat.test.ts). The provider is a thin wrapper around these helpers,
 * which encode the contract open editors rely on to refetch in place after the
 * assistant writes a doc to disk.
 */
import { describe, it, expect } from 'vitest';
import { nextWriteSignal, signalTouches } from './AssistantContext';

describe('nextWriteSignal', () => {
  it('starts the sequence at 1 from no prior signal', () => {
    expect(nextWriteSignal(null, ['loops/x.md'])).toEqual({ paths: ['loops/x.md'], seq: 1 });
  });

  it('increments the sequence on each write so repeat writes to the same path still fire', () => {
    const first = nextWriteSignal(null, ['loops/x.md']);
    const second = nextWriteSignal(first, ['loops/x.md']);
    expect(second).toEqual({ paths: ['loops/x.md'], seq: 2 });
    // A new object identity AND a higher seq guarantee a watching effect re-runs.
    expect(second).not.toBe(first);
  });

  it('ignores empty writes (keeps the previous signal unchanged)', () => {
    const prev = nextWriteSignal(null, ['loops/x.md']);
    expect(nextWriteSignal(prev, [])).toBe(prev);
    expect(nextWriteSignal(null, [])).toBeNull();
  });
});

describe('signalTouches', () => {
  it('is false for a null signal', () => {
    expect(signalTouches(null, 'loops/x.md')).toBe(false);
  });

  it('is true only when the signal includes the given path', () => {
    const signal = nextWriteSignal(null, ['loops/a.md', 'loops/b.md']);
    expect(signalTouches(signal, 'loops/a.md')).toBe(true);
    expect(signalTouches(signal, 'loops/b.md')).toBe(true);
    expect(signalTouches(signal, 'loops/c.md')).toBe(false);
  });
});
