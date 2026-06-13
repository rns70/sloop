# Merged sloop — design spec

**Date:** 2026-06-13
**Status:** Approved (brainstorm), pending implementation plan
**Base:** `dev-jelle`
**Goal:** Merge the two independent sloop versions (`dev-jelle`, `dev-rens`) into one product by porting `dev-rens`'s execution-loop strengths onto the `dev-jelle` base.

## Context

`dev-jelle` and `dev-rens` are two independent implementations of the same core thesis
(markdown is the system, git is the substrate, nested loops gated by machine-checkable evals,
Pi as the execution engine, human in the loop, agent writes sandboxed). They share a common
ancestor but diverged heavily (+167 vs +8 commits; ~32k lines apart).

`dev-jelle` is the base because it has the most surface area to preserve: architect planner,
roles ⊥ workflows, multi-provider model registry, eval harness, agentic authoring assistant,
CLI + `init` scaffold, and the Mission Control loop-tree UI.

This merge ports three `dev-rens` strengths and resolves the central fork between the two
versions in favour of `dev-jelle`'s model.

## Product decisions (locked)

1. **Merge into one product**, `dev-jelle` as the base.
2. **Decomposition stays generated, then editable.** The architect decomposes the databank diff
   into the loop tree; the human edits/adds/removes loops at the approval checkpoint before
   execution. `dev-rens`'s "authoring" becomes editing the generated plan.
3. **Port from `dev-rens`:** retry-with-evidence loop, output-glob sandboxing, in-workspace code.
4. **UI stays Mission Control** (multi-view loop tree). The `dev-rens` paper-first UI is *not*
   adopted.
5. **One repo target:** `databank/` (ADRs = desired state) + `code/` (converged target).
   Replaces the external `SLOOP_TARGET_REPO`.

## Architecture

One workspace repo:

- `databank/` — ADR markdown documents. Desired state, source of truth.
- `code/` — the converged target. A leaf writes only into its declared globs under `code/`.

Core loop (unchanged framing, new mechanics in **bold**):

1. Author ADRs in `databank/` (editor + optional authoring assistant).
2. Kick off a cascade → `GitService` diffs `databank/` (working tree vs last accepted commit) into
   `add/change/delete` deltas.
3. Architect decomposes deltas into an editable loop tree; **each leaf is assigned `allowedOutputs`
   globs** from its file partition.
4. **Approval checkpoint** — human approves / edits / skips loops before any execution
   (`awaiting_approval`). Loops editable only before they start.
5. Per leaf: **`runLeafWithRetry`** — Pi writes into `code/`, **`validateOutputs` rejects any
   out-of-bounds write**, `verify` commands run; **on failure, stdout/stderr/exitCode is fed back
   into the prompt and the leaf retries up to `maxAttempts`**.
6. `recompute()` bubbles status bottom-up (convergence invariant: done iff children done AND own
   criteria pass).
7. Root `done` = "code matches the databank."

## Components and changes (on `dev-jelle`)

### `src/shared` (frozen-pure contract layer)
- `LoopFrontmatter` gains `allowedOutputs: string[]` (glob patterns relative to repo root).
- Add retry config (`maxAttempts`, default 3) — sourced from config with a sane default.
- `LeafResult` (executor result type) gains `attempts: number` and `evidence` (per-attempt
  verify/violation records).
- No clock/env reads in shared (existing rule upheld).

### Executor — refactored into three pure seams
- `executeLeaf({ targetDir, allowedOutputs, criteria }) → { writtenFiles, verifyResults }`
  — spawns Pi against `targetDir`, returns files written and verify outcomes.
- `validateOutputs(writtenFiles, allowedOutputs) → violations[]`
  — pure; matches written paths against allowed globs, returns out-of-bounds paths.
- `runLeafWithRetry(executeFn, verifyFn, maxAttempts) → { status, attempts, evidence }`
  — pure orchestration; runs execute → validate → verify; on failure appends evidence and retries;
  on exhaustion returns `blocked` with evidence preserved.

### Architect / planner
- Populates each leaf's `allowedOutputs` from its existing per-file partition.
- Targets `code/` (paths under the workspace, not an external repo).

### Cascade / git
- Diffs `databank/` (not the whole repo).
- Executor `targetDir` = repo root; leaves write into `code/`.

### Config
- `SLOOP_TARGET_REPO` removed (or defaulted to the workspace itself).
- `maxAttempts` read from `.sloop/config.md` with default 3.

## Data flow

```
author ADRs (databank/)
  → kick off cascade
  → diff databank/  →  deltas (add/change/delete)
  → architect plans tree  (each leaf: allowedOutputs + criteria)
  → APPROVAL CHECKPOINT (editable)
  → per leaf: runLeafWithRetry(
        executeLeaf → Pi writes into code/
        → validateOutputs (reject out-of-bounds)
        → run verify
        → on fail: feed stdout/stderr/exitCode back, retry ≤ maxAttempts)
  → recompute() bubbles status up
  → root done = "code matches databank"
```

## Error handling

- **Out-of-bounds write:** rejected by `validateOutputs`, recorded as evidence, triggers a retry.
- **Verify failure:** stdout/stderr/exitCode captured as evidence and fed into the retry prompt.
- **Attempts exhausted:** leaf → `blocked` with evidence preserved; never a false `done`.
- **Locked criteria:** never weakened by a retry (existing reward-hacking guard upheld).
- **Convergence:** any `blocked`/`failed` descendant blocks its ancestors (no silent partial done).

## Testing

Pure unit tests (no clock/env):
- `validateOutputs` — glob hit, glob miss/violation, nested globs, empty allow-list.
- `runLeafWithRetry` — pass on first attempt, pass after retry, exhaust → `blocked`, evidence
  threaded across attempts, locked-criteria not weakened.
- Architect populates `allowedOutputs` per leaf from file partition.
- Cascade diffs `databank/` and targets `code/`.
- One dry-run (`SLOOP_DRY_RUN`) end-to-end cascade smoke test.

## Implementation / execution model

All work on Jelle's machine, executed by parallel coding agents. One unavoidable barrier: every
stream depends on the shared types + executor seams.

```
FOUNDATION (1 agent): shared types + executor seam refactor
   │  (barrier)
   ├─ STREAM 1: Target model (databank/ + code/, drop SLOOP_TARGET_REPO)
   ├─ STREAM 2: Output-glob sandboxing (validateOutputs + architect populates allowedOutputs)
   └─ STREAM 3: Retry-with-evidence (runLeafWithRetry)
   │
INTEGRATE (1 agent): wire seams in real executor, full suite + dry-run cascade
```

- Streams 2 and 3 are pure functions with unit-test contracts — fully isolated.
- Stream 1 owns cascade/git/architect-target wiring.
- **Parallel agents run in isolated git worktrees**, not the shared checkout: sloop's parallel
  agents sharing one working tree collide on HEAD/branch and clobber writes. Worktrees + the
  integration pass avoid this.

## Out of scope (YAGNI)

- Paper-first UI (Mission Control kept).
- Pluggable execution-strategy seam (one model chosen, not runtime-pluggable).
- `dev-rens` alternatives/fan-out (N candidates + winner selection).
- Configurable external target repo (same-repo only).
- Real recursion beyond the current flat architect→leaves tree (unchanged from `dev-jelle`).
