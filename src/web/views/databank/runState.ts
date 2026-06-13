// Pure reducer for an ADR run's live event stream. Kept free of React/DOM so the
// accumulation logic (status transitions, per-ADR output buffering, criterion
// results, overall outcome) is unit-testable in the node test env (runState.test.ts).
// The RunPanel component is a thin wrapper that feeds AdrRunEvents through `applyRunEvent`
// and renders the resulting snapshot.

import type { AdrRunEvent, AdrStatus } from '../../api-client/index';

/** The live state of a single ADR within the run-set. */
export interface AdrRunState {
  status: AdrStatus;
  /** Accumulated agent output chunks for this ADR (in arrival order). */
  output: string;
  /** Per-criterion pass/fail, keyed by criterion id, latest result wins. */
  criteria: Record<string, boolean>;
}

/** The whole run as accumulated from the event stream. */
export interface RunSnapshot {
  /** Per-ADR state, keyed by relPath. ADRs appear as their first event arrives. */
  byPath: Record<string, AdrRunState>;
  /** relPaths in first-seen order, so the tree can render a stable list. */
  order: string[];
  /** Overall outcome once the run finishes; null while still running. */
  outcome: 'passed' | 'failed' | null;
  /** A terminal error message from an `error` event, if any. */
  error: string | null;
}

/** A fresh snapshot. Seed `order`/`byPath` from the known run-set so every ADR in the
 *  subtree shows (as `running`) before its first event arrives; pass [] to grow lazily. */
export function initialRunSnapshot(runSet: string[] = []): RunSnapshot {
  const byPath: Record<string, AdrRunState> = {};
  for (const relPath of runSet) byPath[relPath] = emptyAdrState();
  return { byPath, order: [...runSet], outcome: null, error: null };
}

function emptyAdrState(): AdrRunState {
  return { status: 'running', output: '', criteria: {} };
}

/** Ensure a path is tracked, returning a snapshot whose `byPath`/`order` include it. */
function ensurePath(snap: RunSnapshot, relPath: string): RunSnapshot {
  if (snap.byPath[relPath]) return snap;
  return {
    ...snap,
    byPath: { ...snap.byPath, [relPath]: emptyAdrState() },
    order: [...snap.order, relPath],
  };
}

/**
 * Fold one run event into the snapshot, returning a new snapshot (immutable — callers
 * compare identity to decide whether to re-render). Unknown/defensive cases return the
 * input unchanged.
 */
export function applyRunEvent(snap: RunSnapshot, e: AdrRunEvent): RunSnapshot {
  switch (e.type) {
    case 'status': {
      const next = ensurePath(snap, e.relPath);
      return {
        ...next,
        byPath: {
          ...next.byPath,
          [e.relPath]: { ...next.byPath[e.relPath], status: e.status },
        },
      };
    }

    case 'output': {
      const next = ensurePath(snap, e.relPath);
      const cur = next.byPath[e.relPath];
      return {
        ...next,
        byPath: {
          ...next.byPath,
          [e.relPath]: { ...cur, output: cur.output + e.chunk },
        },
      };
    }

    case 'eval': {
      const next = ensurePath(snap, e.relPath);
      const cur = next.byPath[e.relPath];
      return {
        ...next,
        byPath: {
          ...next.byPath,
          [e.relPath]: {
            ...cur,
            criteria: { ...cur.criteria, [e.criterionId]: e.passed },
          },
        },
      };
    }

    case 'done':
      // The run finished; the terminal `status` events have already set each ADR's
      // final status, so we only record the overall outcome here.
      return { ...snap, outcome: e.status };

    case 'error':
      return { ...snap, error: e.message };

    default:
      return snap;
  }
}
