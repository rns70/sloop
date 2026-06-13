# Editable Workflow Steps — Design

**Goal:** Make a workflow's full structural definition editable in the app and round-tripped
to its markdown file. Today a workflow's `steps` (the ordered `name → role → model`, plus
`gate`) are shown read-only in the editor; only the name and guidance prose are editable.
After this change the entire workflow is definable in-app and persisted to
`.sloop/workflows/<id>.md`.

## Background

Workflows already live as markdown in `.sloop/workflows/*.md`: frontmatter holds
`id`, `name`, `steps[]`; the body is the `guidance` prose. `filesService.listWorkflows()`
parses them into `WorkflowDef`, and the architect / cascade engine consume them by id.

The web editor for a workflow is `src/web/views/libraries/LibraryFile.tsx` (route
`/libraries/workflows/:id`). It edits the **name** and the **guidance body** via the shared
`MarkdownEditor`, but renders `steps` read-only as `steps.map(s => s.name).join(' → ')`.
On save it reconstructs the file with `serializeWorkflow(...)` (`src/web/shell/createItem.ts`)
and writes it through `putFile` → `PUT /api/files/:relPath`.

**Two problems this design fixes:**

1. **Steps aren't editable in the UI** — the core request.
2. **Round-trip bug:** `serializeWorkflow` (createItem.ts:48) emits only `name/role/model`
   per step and **drops `gate`**. Saving *any* workflow through the app — even editing only
   the prose — silently strips `gate: true` (e.g. spec-driven's `verify` gate, tdd's gates),
   corrupting convergence behavior. So workflows are not fully persisted today even for the
   fields that exist.

## Approach (chosen)

Extend `LibraryFile`'s workflow branch with a structured steps editor, and keep persistence
on the existing client-serialize → `putFile` path. Rejected alternative: a typed
`updateWorkflow` API endpoint with server-side serialization — more "correct" but a larger
blast radius (new contract method + `real.ts` + `mock.ts` + `api-client`) into the server
layer currently mid-refactor, for no user-visible difference. Staying on the `putFile` path
matches how roles already persist.

## Components

### 1. Data model — no change

`WorkflowDef.steps: { name: string; role: string; model: string; gate?: boolean }[]`
already covers the editable surface. The whole definition is `name` + `steps[]` + `guidance`,
all already in the markdown. `id` stays fixed (it is the filename; renaming is out of scope).

### 2. New component — `WorkflowStepsEditor.tsx`

Location: `src/web/views/libraries/WorkflowStepsEditor.tsx`. Controlled component.

Props:
- `steps: WorkflowStep[]`
- `roles: RoleDef[]`
- `models: ModelOption[]`
- `onChange(steps: WorkflowStep[]): void`

(`WorkflowStep` = the element type of `WorkflowDef['steps']`.)

Per-step row:
- `name` — text input
- `role` — `<select>` of role ids (reuse the `withCurrent` helper pattern from `LoopEditor`
  so an unknown/dropped role stays selectable)
- `model` — `<select>` of model aliases (same `withCurrent` treatment)
- `gate` — checkbox
- move-up / move-down / remove buttons

Footer: **+ Add step** appends a default step — `name: ''`, `role` = first role id,
`model` = that role's `defaultModel` (falling back to the first model alias), `gate: false`.

Reorder is via up/down buttons only — no drag-and-drop dependency (KISS). Styling mirrors
`LoopEditor` (`SELECT_CLASS`, `PropertyRow`, design primitives).

### 3. `LibraryFile` wiring

In the workflow branch:
- Hold `steps` in `useState`, seeded from `workflow.steps` when the workflow loads (and reset
  on id change, like the other fields).
- Replace the read-only `steps.map(...).join(' → ')` line with `<WorkflowStepsEditor>`.
- Fetch `roles` and `models` (via `getRoles` / `getModels`) to feed the dropdowns.
- Extend the `dirty` check to include steps changing.
- Pass edited `steps` into `serializeWorkflow` on save instead of the original
  `workflow.steps`.

### 4. Fix `serializeWorkflow` (createItem.ts)

Emit `gate: true` for any step whose `gate` is truthy; omit the key otherwise (matching the
minimal-YAML style of the source files, which only write `gate` when `true`). This makes
`serializeWorkflow` the single source of truth for workflow YAML and is the round-trip-bug fix.

### 5. Validation before save

Block save (disable the Save button + inline message) unless:
- there is ≥1 step, and
- every step has a non-empty trimmed `name`, and
- every step has a `role` and a `model` set.

Fail-fast at the boundary; an empty or nameless-step workflow is never written to disk.

## Data flow

```
WorkflowStepsEditor (edit steps) ─┐
EditableTitle (edit name) ────────┼─► LibraryFile state ─► serializeWorkflow(meta, body)
MarkdownEditor (edit guidance) ───┘                         └─► putFile(relPath, content)
                                                                 └─► PUT /api/files/:relPath
                                                                      └─► .sloop/workflows/<id>.md
```

On next `getWorkflows()` / `listWorkflows()` the edited steps parse straight back out — the
markdown file is the single source of truth.

## Error handling

- Save validation failures are surfaced inline and disable Save (no partial writes).
- `putFile` rejection surfaces the existing `note` error path in `LibraryFile` ("Save failed").
- Unknown role/model aliases already present in a file remain selectable (`withCurrent`) so
  loading a workflow never silently drops a value the user didn't choose to change.

## Testing

- **Unit — `serializeWorkflow` round-trip (regression for the bug):** serialize a workflow
  whose steps include a gated step, reparse via `parseFrontmatter` (or `listWorkflows`), and
  assert step order and `gate` survive. Include a real-file assertion: load `spec-driven`
  (or `tdd`), serialize, reparse, and confirm identical steps including the verify gate.
- **Component — `WorkflowStepsEditor`:** add, remove, reorder (up/down), and edit
  name/role/model/gate each call `onChange` with the expected next `steps`.
- **Validation:** Save is disabled when steps is empty or any step name is blank.

## Out of scope (YAGNI)

- Renaming a workflow's `id` (file rename).
- Drag-and-drop reordering.
- A typed `updateWorkflow` API endpoint / server-side serialization.
- Per-step fields beyond `name/role/model/gate`.

## Verification note

The working tree is mid-refactor (templates→workflows) and the build is currently red.
Establish a green `npm run typecheck` / `npm test` baseline (or record the pre-existing
failures) before verifying this work, so new failures are distinguishable from inherited ones.
