# Design — Cascade "View diff" + "Merge to dev-jelle"

**Date:** 2026-06-13
**Status:** Approved (verbal), pending implementation

## Problem

The cascade success banner (`src/web/views/mission-control/CascadeView.tsx`) shows two
buttons — **View diff** and **Merge to main** — that were never wired (`title="Wired in
WP-6 (integration)"`, no handler). There is no API endpoint, no web-client method, and
no git capability behind them. `GitService` only operates on the *workspace* repo
(databank); it has no view of the *target* repo (`SLOOP_TARGET_REPO`) where the cascade
agent actually edits code.

This design wires both buttons against the target repo.

## Semantics (decided with the user)

- **Target of "merge"** = the target repo's **currently checked-out branch** (which is
  `dev-jelle` in the user's setup). The agent edits the working tree in place, so
  "merge to dev-jelle" = **stage + commit those working-tree changes onto the current
  branch**. No branch switching (respects the shared-checkout hazard), no push,
  reversible via `git reset`.
- **View diff** = read-only diff of the target repo's pending changes (HEAD vs working
  tree, including untracked). For the single-cascade flow this is "the cascade's diff."

## Architecture

### 1. Git layer — `src/server/git/targetGit.ts` (new)

Keeps the databank-focused `GitService` single-purpose; target-repo ops live separately.

```
interface TargetGit {
  diffTarget(): Promise<CodeDiff>;                  // pending changes, read-only
  mergeToBranch(message: string): Promise<MergeResult>;
}
type CodeDiff    = { files: CodeDelta[] };
type CodeDelta   = { relPath: string; delta: 'add'|'change'|'delete'; before: string; after: string };
type MergeResult = { branch: string; sha: string; files: number };
```

- Rooted at `resolveTargetRepo(env)` (the same resolver `piExecutor` uses), reusing the
  fixed sloop identity + `-c` overrides pattern from `GitServiceImpl`.
- `diffTarget()`: `git status` → for each changed file, `before` = `git show HEAD:path`
  (`''` if new), `after` = working-tree read (`''` if deleted). Mirrors `diffDatabank`.
- `mergeToBranch(message)`: read current branch; if `SLOOP_MERGE_BRANCH` is set and ≠
  current branch, throw a `Conflict` advising the user to check it out first (never
  auto-switch under the shared checkout). Otherwise `git add -A` + commit; return
  `{ branch, sha (7-char), files }`. Clean tree → `Conflict('nothing to merge')`.

### 2. API

- `contract.ts`: add `CascadeDiffResponse` (= `CodeDiff`) and `MergeCascadeResponse`
  (= `MergeResult`); add the two routes to the documented surface and the `SloopApi`
  interface.
- `real.ts`: `RealApi.getCascadeDiff(id)` → `targetGit.diffTarget()`;
  `RealApi.mergeCascade(id)` → `targetGit.mergeToBranch(...)`. Construct one `TargetGit`
  in `RealApi.create`. (`id` is accepted for URL symmetry / future per-cascade
  attribution but the diff is the repo's current pending set.)
- `buildServer.ts`: `GET /api/cascades/:id/diff`, `POST /api/cascades/:id/merge`. The
  existing error mapper turns `Conflict` → 409.

### 3. Web

- `api-client/index.ts`: `getCascadeDiff(id)`, `mergeCascade(id)`.
- `CascadeView.tsx` `SuccessBanner`:
  - **View diff** toggles an inline `<CascadeDiff>` panel that fetches `getCascadeDiff`
    and renders each file with the existing `InlineDiffView`.
  - **Merge to main** → relabeled **"Merge to {branch}"**; on click calls
    `mergeCascade`, then shows `Merged · {sha}` or an inline error. Disabled while
    in-flight.

## Error handling

- Clean target tree: diff → empty panel ("No changes"); merge → 409 "nothing to merge",
  surfaced as an inline message (not a crash).
- `SLOOP_MERGE_BRANCH` ≠ current branch → 409 with a checkout instruction.
- Git/exec failures → 500 with the error message (existing mapper).

## Testing

- **Backend (node-vitest, mirrors `real.test.ts`):** temp target repo with a baseline
  commit + working-tree edits. Assert: `diffTarget` lists the changed files with correct
  `delta`/`before`/`after`; `mergeToBranch` creates a commit, leaves the tree clean,
  returns the branch + sha; a clean tree throws the friendly no-op; `SLOOP_MERGE_BRANCH`
  mismatch throws.
- **Frontend:** button wiring verified in the browser (no jsdom/RTL in this repo, per
  the `AssistantContext.test.ts` convention).

## Out of scope / caveats

- The repo's working tree currently does not `typecheck` (an unrelated in-progress
  refactor dropped exports from `shared/index.ts`). New code will compile in isolation;
  this design does not fix the pre-existing refactor breakage.
- No push, no remote interaction, no per-cascade branch isolation.
