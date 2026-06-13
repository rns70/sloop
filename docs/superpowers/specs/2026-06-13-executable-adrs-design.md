# Executable ADRs — design

Date: 2026-06-13
Status: approved (brainstorm)

## Purpose

Replace the cascade system with **executable ADRs**. An ADR file in the databank
becomes the unit of execution. Running an ADR hands its body + acceptance criteria
to a single agent (Pi) that edits code until the criteria pass. Running a parent ADR
pulls its whole subtree into that one run. You can also run a single (leaf) ADR.

This adopts the dev-rens model (the doc *is* the executable loop) while keeping
sloop's existing ADR shape, UI components, and workflow/role concepts.

## What this deletes

- The architect / planner (`src/server/planner/architect.ts`).
- The cascade engine and convergence (`src/server/cascade/cascadeEngine.ts`,
  `convergence.ts`).
- The ephemeral `cascades/<id>/` directory + `LoopDoc`/`LoopFrontmatter`/`CascadeSummary`
  as the run vehicle.
- Kickoff-by-databank-diff and the **approval checkpoint** (auto-apply instead).
- Cascade UI: `CascadeView`, `CascadeContext`, `Checkpoint`, `KickoffMenu`, phase
  visualization. (Tree/output/streaming components are salvaged into the ADR run panel.)
- `/api/cascades*` endpoints.

## What this keeps

- The ADR shape: `acceptanceCriteria` (text + optional `verify` shell command) stays
  in the markdown body, parsed on save exactly as today.
- Workflows + roles, **demoted** to suppliers of model + brief preamble only. No
  step pipeline, no phases.
- The Pi executor's agent-session + criteria-verification machinery (reused by the
  new runner).
- Git plumbing, model registry/resolver, the assistant.

## Data model

ADRs gain executable metadata. `AdrDoc` (in `src/shared/types.ts`) extends to:

```ts
export type AdrStatus = 'idle' | 'running' | 'evaluating' | 'passed' | 'failed';

export interface AdrDoc {
  id: string;
  relPath: string;
  title: string;
  body: string;
  acceptanceCriteria: AcceptanceCriterion[];
  children: string[];        // ordered child ADR ids (authoritative parent->child link)
  status: AdrStatus;          // stored in frontmatter, NOT derived/bubbled
  outputs: string[];          // optional allow-list of file globs the agent may touch
  workflow?: string;          // optional: supplies model + brief preamble
  role?: string;              // optional: supplies model + brief preamble
}
```

- `children` is the only authoritative hierarchy link. `parent` is *derived* by
  scanning who references whom; it is not authored or stored.
- `status` is written by the runner as a run progresses. There is no convergence
  engine — a parent's status reflects its own run's outcome (the run covers the
  subtree, so descendants share the outcome).
- Frontmatter round-trips: unknown fields are preserved; `children`/`status`/`outputs`
  default to `[]`/`idle`/`[]` for existing ADRs with no migration step.

## Execution

New module `src/server/adr/adrRunner.ts` exposes:

```ts
runAdr(relPath: string, onEvent: (e: AdrRunEvent) => void, signal?: AbortSignal): Promise<AdrRunResult>
```

Algorithm:

1. Load all ADRs; build the hierarchy from `children` lists, with **cycle detection**.
2. Collect the run-set = source ADR + all recursive descendants, ordered depth-first.
3. Build ONE agent prompt: each ADR's body + the combined acceptance criteria (text)
   + the **union of `outputs`** as the edit sandbox. Resolve model + brief from the
   attached workflow/role (or the config default).
4. Use the source ADR's git diff vs HEAD as context when present, else the whole body
   (dev-rens behavior).
5. Run the agent in the target repo, streaming output. Reject edits outside the
   union of allowed outputs.
6. Run every `verify` command across the run-set. On failure, feed evidence back and
   retry until criteria pass or the configured max-attempts is reached (reuse the
   existing executor retry/verify machinery and the config setting).
7. On pass: **auto-apply** — edits are already in the working tree; mark statuses
   `passed`. On fail: leave edits + evidence visible; mark statuses `failed`.
8. Each ADR's frontmatter `status` is persisted as the run transitions
   (`idle` -> `running` -> `evaluating` -> `passed|failed`).

### Concurrency / safety

Single agent, one subtree at a time. Per the shared-checkout hazard, **runs are
serialized**: one active run; a second run request is rejected (409) or queued. No
parallel sibling agents (the single-agent model already implies this).

## API (`src/server/api/contract.ts`, `real.ts`)

Add:

```
POST /api/adrs/:relPath/run     -> { runId: string }        starts a run (409 if one is active)
WS   /api/runs/:runId/stream    -> AdrRunEvent               live output + status transitions
GET  /api/runs                  -> RunHistoryEntry[]         history drawer feed
GET  /api/runs/:runId           -> RunHistoryEntry           one run's detail + log
```

```ts
export type AdrRunEvent =
  | { type: 'status'; relPath: string; status: AdrStatus }
  | { type: 'output'; relPath: string; chunk: string }
  | { type: 'eval'; relPath: string; criterionId: string; passed: boolean }
  | { type: 'done'; runId: string; status: 'passed' | 'failed' }
  | { type: 'error'; message: string };

export interface RunHistoryEntry {
  id: string;
  rootRelPath: string;        // the ADR that was run
  runSet: string[];           // relPaths included in the run
  status: 'passed' | 'failed';
  createdAt: string;          // ISO, stamped server-side
  evidence: string[];         // eval evidence / failures
}
```

Remove all `/api/cascades*` endpoints + `SloopApi` cascade methods.

## UI — mission control *inside* the ADR

- `AdrEditor` (`src/web/views/databank/AdrEditor.tsx`) gains a **run panel** assembled
  from the salvaged mission-control components, restyled to sloop's UI:
  - a **Run** button (runs this ADR + its subtree);
  - a compact subtree (reuse `LoopTree`/`LoopNode`, repointed at ADRs) showing which
    ADRs are in the run and their live status;
  - streamed agent output;
  - the existing `InlineDiff` for changes.
- New **history drawer** (dev-rens style): runs, eval results, rollback points; fed by
  `GET /api/runs`.
- The standalone Mission Control route is removed; its streaming/tree/output pieces are
  salvaged into the run panel.

## Testing

- `planRunSet` (hierarchy traversal, sibling ordering, cycle detection) — pure unit tests.
- `outputs` allow-list validation (in-scope accepted, out-of-scope rejected) — unit tests.
- Runner integration with a mock agent (mirrors existing `pi-run` tests): pass on green
  criteria, retry-then-pass, fail at max-attempts.
- ADR frontmatter round-trip: `children`/`status`/`outputs` + unknown fields preserved.

## Out of scope

- Auto-materialized "code controller docs" (dev-rens needs them; we keep `outputs`
  inline on the ADR, so they are unnecessary).
- Selecting winners among alternatives; pause/resume of a live agent subprocess.
- Per-ADR workflow step pipelines / phase visualization.
