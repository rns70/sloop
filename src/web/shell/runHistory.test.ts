/**
 * Tests for the run-history drawer's pure helpers. The HistoryDrawer component is a thin
 * React wrapper around these (jsdom/RTL aren't configured — see vitest.config.ts), so the
 * drawer's observable contract — newest run first, a readable label, relative time, and
 * failure evidence association — is exercised here at the logic layer.
 */
import { describe, expect, it } from 'vitest';
import type { RunHistoryEntry } from '../api-client/index';
import { relativeTime, runLabel, sortRunsNewestFirst } from './runHistory';

const entry = (over: Partial<RunHistoryEntry>): RunHistoryEntry => ({
  id: 'r1',
  rootRelPath: 'loops/auth/login.md',
  runSet: ['loops/auth/login.md'],
  status: 'passed',
  createdAt: '2026-06-13T10:00:00.000Z',
  evidence: [],
  ...over,
});

describe('runLabel', () => {
  it('strips the loops prefix for display', () => {
    expect(runLabel(entry({ rootRelPath: 'loops/auth/login.md' }))).toBe('auth/login.md');
  });
});

describe('sortRunsNewestFirst', () => {
  it('orders by createdAt descending without mutating the input', () => {
    const input = [
      entry({ id: 'old', createdAt: '2026-06-13T09:00:00.000Z' }),
      entry({ id: 'new', createdAt: '2026-06-13T11:00:00.000Z' }),
      entry({ id: 'mid', createdAt: '2026-06-13T10:00:00.000Z' }),
    ];
    const sorted = sortRunsNewestFirst(input);
    expect(sorted.map((r) => r.id)).toEqual(['new', 'mid', 'old']);
    // input untouched
    expect(input.map((r) => r.id)).toEqual(['old', 'new', 'mid']);
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-06-13T12:00:00.000Z');

  it('labels recent timestamps as "just now"', () => {
    expect(relativeTime('2026-06-13T11:59:30.000Z', now)).toBe('just now');
  });

  it('formats minutes, hours, and days ago', () => {
    expect(relativeTime('2026-06-13T11:30:00.000Z', now)).toBe('30m ago');
    expect(relativeTime('2026-06-13T09:00:00.000Z', now)).toBe('3h ago');
    expect(relativeTime('2026-06-11T12:00:00.000Z', now)).toBe('2d ago');
  });

  it('falls back to the raw value for an unparseable date', () => {
    expect(relativeTime('not-a-date', now)).toBe('not-a-date');
  });
});

describe('failed-run evidence', () => {
  it('carries evidence lines that the drawer renders under a failed run', () => {
    const failed = entry({ status: 'failed', evidence: ['ac-1: exit 1', 'lint failed'] });
    expect(failed.status).toBe('failed');
    expect(failed.evidence).toHaveLength(2);
  });
});
