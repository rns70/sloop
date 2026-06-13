# Cascade Workflow Phases Design

Date: 2026-06-13

## Purpose

Make a cascade visibly reflect the **chosen workflow's ordered steps**, and show which
step/phase each generated leaf loop falls into. Today the workflow only influences the
architect's role/model choices; the resulting leaf loops are tagged with a `role` and a
`workflow` id but never record *which workflow step* they fulfill. The mission-control
cascade therefore renders a flat role-tagged tree with no notion of phase.

This design adopts the `dev-rens` model — where workflow stages are first-class, ordered,
and individually status-bearing — and brings it into `dev-jelle`'s architecture: each leaf
records its workflow step, and the cascade is rendered as an ordered, phase-grouped tree.

## Decision

A "phase" is the set of leaf loops fulfilling one workflow step. Phases are **derived at
render time** by grouping the architect's direct leaf children by their `step` and ordering
them by the workflow's `steps[]` array. The workflow remains the single source of truth for
phase order, role/model defaults, and `gate` flags. No phase entity is persisted.

## Data Model

`src/shared/types.ts` — add one optional field to `LoopFrontmatter`:

```ts
export interface LoopFrontmatter {
  // …existing fields…
  workflow?: string;
  step?: string;        // NEW — name of the workflow step this leaf fulfills, e.g. "implement"
  // …existing fields…
}
```

- `step` holds the **name** of a `WorkflowDef.steps[].name`, not an index — names are the
  stable, human-readable key the architect already sees.
- The field is optional so existing on-disk cascades remain valid; leaves without it are
  handled by the backward-compatibility rule below.
- No new persisted phase/stage type. `WorkflowDef.steps` (already
  `{ name; role; model; gate? }[]`) supplies order, role/model defaults, and gate flags.

## Architect Produces The Step

`src/server/planner/prompt.ts`

1. **Prompt schema** — add `"step"` to the leaf JSON shape and a rule:
   - Schema line: `"step": "implement",` (one of the workflow step names).
   - Rule: *"Tag each leaf with the `step` whose role it fulfills. Use the exact step name
     from the Steps list above."*

2. **Parsing (`parseArchitectResponse`)** — resolve `step` defensively, mirroring the
   existing `resolveLeafModel` pattern:
   - If the planner returns a `step` string that matches a `workflow.steps[].name`, use it.
   - Else fall back to the **first** step whose `role` equals the leaf's `role`.
   - Else leave `step` `undefined` (the leaf will render in the "Unphased" group).
   - Carry `step` through `ProposedLeaf` and into the materialized leaf frontmatter.

   A defensive fallback is required (not a hard error): a single mis-named step must not
   fail the whole cascade plan, consistent with how model resolution already degrades.

## Rendering — Phase-Grouped Tree

`src/web/views/mission-control/`

### Grouping helper (pure, tested)

A pure function builds the ordered phase list from the architect's leaf children + the
workflow. New file `phaseGroups.ts`:

```ts
interface PhaseGroup {
  step: WorkflowDef['steps'][number] | null; // null => the "Unphased" trailing group
  index: number;                              // 1-based display index; 0 for Unphased
  leaves: LoopDoc[];
  status: LoopStatus;                         // aggregate, derived
}

function buildPhaseGroups(leaves: LoopDoc[], workflow: WorkflowDef): PhaseGroup[];
```

Rules:
- Emit **one group per `workflow.steps` entry, in workflow order**, including steps with
  **zero leaves** (rendered as an empty, `queued` phase). Showing the full workflow shape is
  the primary visualization win and mirrors dev-rens' "show all stages" behavior.
- Leaves whose `step` is `undefined` or matches no workflow step collect into a trailing
  **"Unphased"** group (`step: null`). Omit this group entirely when it has no leaves.

### Aggregate status rule (pure, tested)

For a group's leaves, derive a single `LoopStatus`:
1. any leaf `failed` → `failed`
2. else any leaf `executing` or `review` → `executing`
3. else all leaves `done` → `done`
4. else → `queued`  (also the value for an empty phase)

### Components

- New `LoopPhaseGroup.tsx` (single purpose: render one phase header + its leaves):
  - Header: `index · step.name` tag, the step's role·model defaults, a `gate` marker when
    `step.gate`, and an aggregate `StatusDot` + count (e.g. `1/3`).
  - Collapsible, consistent with `LoopNode` disclosure; defaults open.
  - Renders each leaf via the existing `LoopNode`.
- `CascadeView` / `LoopTree`: under the architect root, replace the direct map-over-children
  with `buildPhaseGroups(...).map(g => <LoopPhaseGroup …/>)`.
- The per-leaf role/step badge on `LoopNode` rows is dropped for leaves shown inside a phase
  group, since the header now carries role/step. (`LoopNode` keeps the badge for any context
  where it is not nested under a phase group — e.g. the architect root row.)

### Scope boundaries

- Grouping applies **only to the architect's direct leaf children**. Deeper trees
  (architect → inner → leaf), if ever produced, are unaffected and render as today.
- The leaf `LoopPage` stage line (`plan → execute → review`) is unchanged.

## Backward Compatibility

- Existing cascades have no `step` on their leaves: every leaf falls into the "Unphased"
  group, so nothing disappears or breaks — the view degrades to a single group.
- `LoopFrontmatter.step` is additive and optional; no migration of on-disk docs is required.

## Testing Strategy

- `src/server/planner/architect.test.ts` (architect prompt + parse):
  - architect prompt text lists the workflow step names and the `step` schema line;
  - `parseArchitectResponse` populates `step` from valid planner output;
  - falls back to the role-matched step when `step` is omitted/mis-named;
  - leaves `step` undefined when no role match exists.
- New `src/web/views/mission-control/phaseGroups.test.ts`:
  - groups order by the workflow, not by leaf order;
  - empty phases are included as `queued`;
  - aggregate-status derivation covers each branch (failed / active / done / queued);
  - undefined/mismatched `step` collects into the trailing "Unphased" group, which is
    omitted when empty.

## Out Of Scope (YAGNI)

- Persisting per-step status to disk (status is derived at render time only).
- Editing or reordering workflow steps from the cascade view.
- Changing the leaf `LoopPage` stage line.
- Phase grouping for non-leaf (deeper) tree levels.
