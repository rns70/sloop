// Pure helpers for the run-history drawer. Kept free of React/DOM so the derivation/
// formatting logic is unit-testable in the node test env (historyDrawer.test.ts). The
// HistoryDrawer component is a thin wrapper that fetches runs and renders these.

import type { RunHistoryEntry } from '../api-client/index';

/** The ADR file name (sans the `loops/` prefix) for a run's root. */
export function runLabel(entry: RunHistoryEntry): string {
  return entry.rootRelPath.replace(/^loops\//, '');
}

/** Sort runs newest-first by `createdAt` (ISO strings sort lexicographically; ties keep
 *  input order). Returns a new array, leaving the input untouched. */
export function sortRunsNewestFirst(runs: RunHistoryEntry[]): RunHistoryEntry[] {
  return [...runs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/**
 * A compact relative-time label ("just now", "5m ago", "3h ago", "2d ago") for a run's
 * ISO timestamp, relative to `now`. Falls back to the raw value for an unparseable date.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const secs = Math.max(0, Math.round((now - then) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}
