/**
 * Output-glob sandbox. Given the files an agent wrote and the leaf's `allowedOutputs`
 * globs, return the files that fall OUTSIDE the allow-list (the violations).
 *
 * FOUNDATION STUB: returns no violations. Task 2 (Sandboxing) implements real glob
 * matching. The empty/undefined allow-list semantics (= unrestricted) are final and
 * must be preserved: legacy leaves carry no `allowedOutputs` and must keep running.
 */
export function validateOutputs(writtenFiles: string[], allowedOutputs: string[] | undefined): string[] {
  void writtenFiles; // TODO(Task 2): real matching reads this
  if (!allowedOutputs || allowedOutputs.length === 0) return [];
  return [];
}
