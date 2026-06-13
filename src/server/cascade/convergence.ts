import type { LoopDoc, LoopStatus } from '../../shared/index';

/**
 * The convergence invariant (spec §3) — the heart of sloop, expressed as pure
 * functions over the flat loop list. No I/O, no clock, fully unit-tested.
 *
 *   A loop is **done** iff every child loop is done AND its own acceptance
 *   criteria pass. Completion therefore bubbles up the tree; a failed or blocked
 *   descendant surfaces as a **blocked** ancestor, pinpointing where reconciliation
 *   stalled.
 *
 * Status is *derived*, not merely stored: an inner loop cannot be "done" while a
 * child is still running, and a leaf is "done" exactly when its criteria pass.
 */

/** Pre-approval statuses — a subtree that has not started running yet. */
const PRE_RUN: readonly LoopStatus[] = ['planned', 'awaiting_approval'];

/** Statuses that mean a subtree has stalled and must block its ancestors. */
const STALLED: readonly LoopStatus[] = ['failed', 'blocked'];

/** Index loops by their frontmatter id for O(1) child lookups. */
export function indexById(loops: readonly LoopDoc[]): Map<string, LoopDoc> {
  return new Map(loops.map((l) => [l.frontmatter.id, l] as const));
}

function ownCriteriaPass(loop: LoopDoc): boolean {
  // Vacuously true for a loop with no criteria (e.g. the architect root, whose
  // truth is entirely delegated to its children).
  return loop.frontmatter.acceptanceCriteria.every((c) => c.passed);
}

/**
 * Predicate form of the invariant against *stored* statuses: a loop is done iff
 * every child's stored status is `done` and its own criteria pass. A missing
 * child reference counts as not-done (fail safe — a dangling id must never let a
 * parent silently complete).
 */
export function isLoopDone(loop: LoopDoc, byId: Map<string, LoopDoc>): boolean {
  const childrenDone = loop.frontmatter.children.every(
    (id) => byId.get(id)?.frontmatter.status === 'done',
  );
  return childrenDone && ownCriteriaPass(loop);
}

/** Derive a single loop's status from its (already-derived) child statuses. */
function derive(loop: LoopDoc, childStatuses: LoopStatus[]): LoopStatus {
  const current = loop.frontmatter.status;
  const passed = ownCriteriaPass(loop);

  if (childStatuses.length === 0) {
    // Leaf: its truth is its acceptance criteria. An execution verdict of
    // failed/blocked stands — never promote it to done off a vacuously-true empty
    // criteria set. Otherwise a leaf with passing criteria is done; a leaf still
    // marked `done` whose criteria have regressed is no longer done (surface that
    // as `executing` — work to redo — rather than lie).
    if (current === 'failed' || current === 'blocked') return current;
    if (passed) return 'done';
    return current === 'done' ? 'executing' : current;
  }

  // Inner / architect loop: a failed or blocked descendant blocks the whole subtree.
  if (childStatuses.some((s) => STALLED.includes(s))) return 'blocked';

  if (childStatuses.every((s) => s === 'done') && passed) return 'done';

  // Not converged and nothing has stalled. If the entire subtree is still pending
  // (and this loop itself has not started), preserve the pre-approval status so a
  // freshly-proposed tree stays `awaiting_approval` / `planned`. Otherwise work is
  // underway somewhere below: report `executing`.
  if (childStatuses.every((s) => PRE_RUN.includes(s)) && PRE_RUN.includes(current)) {
    return current;
  }
  return 'executing';
}

/**
 * Recompute every loop's status bottom-up and return a new list (input is not
 * mutated). Loops whose derived status is unchanged are returned as-is so callers
 * can cheaply detect what to persist.
 */
export function recompute(loops: readonly LoopDoc[]): LoopDoc[] {
  const byId = indexById(loops);
  const memo = new Map<string, LoopStatus>();
  const visiting = new Set<string>();

  function statusOf(id: string): LoopStatus {
    const cached = memo.get(id);
    if (cached) return cached;

    const loop = byId.get(id);
    // Dangling child reference — block the subtree so it cannot silently complete.
    if (!loop) return 'blocked';

    // Cycle guard: frontmatter trees should be acyclic, but never recurse forever.
    if (visiting.has(id)) return loop.frontmatter.status;

    visiting.add(id);
    const childStatuses = loop.frontmatter.children.map((cid) => statusOf(cid));
    const derived = derive(loop, childStatuses);
    visiting.delete(id);

    memo.set(id, derived);
    return derived;
  }

  return loops.map((l) => {
    const status = statusOf(l.frontmatter.id);
    if (status === l.frontmatter.status) return l;
    return { ...l, frontmatter: { ...l.frontmatter, status } };
  });
}

/**
 * The status of the cascade as a whole = the status of its root loop (the one
 * with no parent). Runs a recompute so callers always get the derived truth.
 */
export function rootStatus(loops: readonly LoopDoc[]): LoopStatus {
  const recomputed = recompute(loops);
  const root = recomputed.find((l) => !l.frontmatter.parent) ?? recomputed[0];
  return root?.frontmatter.status ?? 'planned';
}
