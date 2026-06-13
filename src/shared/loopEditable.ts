import type { LoopStatus } from './types';

/**
 * The statuses in which a loop has not yet begun executing and may therefore be
 * edited (plan body, model, role, acceptance criteria). Once a leaf reaches
 * `executing` — or any later state — its plan is frozen so an edit can't race the
 * running agent or rewrite history the convergence invariant already acted on.
 *
 * Single source of truth: both the API guard (RealApi.updateLoop) and the UI's
 * "Edit" affordance derive from this list, so they can never disagree.
 */
export const EDITABLE_LOOP_STATUSES: readonly LoopStatus[] = [
  'planned',
  'awaiting_approval',
  'queued',
];

/** Whether a loop in `status` may still be edited (see {@link EDITABLE_LOOP_STATUSES}). */
export function isLoopEditable(status: LoopStatus): boolean {
  return EDITABLE_LOOP_STATUSES.includes(status);
}
