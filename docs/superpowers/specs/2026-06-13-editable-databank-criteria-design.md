# Editable databank acceptance criteria — design

**Date:** 2026-06-13
**Status:** Approved (pending spec review)
**Author:** Jelle Maas (with Claude)

## Problem

In the databank ADR editor, acceptance criteria *feel hardcoded* — you can't easily
change them. The cause:

1. The editor shows criteria in a **read-only panel** below the markdown
   (`AdrEditor.tsx:144-168`). That panel looks like the authoritative, locked-down
   copy of the criteria, but it has no add/edit/remove affordance.
2. On disk the criteria use a machine-oriented format
   (`- [ ] **ac-1** text — verify: \`cmd\` 🔒`). The `**ac-1**` ids and `🔒` are
   noise when hand-editing a design doc.

The criteria *are* already part of the markdown body — they just don't feel editable
because the prominent copy is read-only and the syntax is cluttered.

## Why criteria are parsed at all (context)

The structured parsing is **not** pointless: when an ADR is edited and a cascade is
planned from the databank diff, the planner reads the ADR's criteria and **seeds each
loop's criteria from them** (`real.ts:140-159`, carrying `text` + optional `verify`).
That design-doc → loop flow is the reason the criteria are extracted into a structured
`AcceptanceCriterion[]`.

The execution engine also already supports command-free, agent-reviewed criteria as a
first-class concept: criteria **with** a `verify` command are machine-checked; criteria
**without** one are deliberately skipped by machine verify and left to the agent to
adjudicate (`piExecutor.ts:165-190`). So "criteria are checkable reference statements the
implementing agent reviews" is exactly how sloop already works — no engine change needed.

## Decision

Stop special-casing criteria in the **databank**. Let them be plain markdown in the ADR
body, edited inline like any checklist. Keep the structured machinery only where it earns
its keep: **loops** (verify commands, `passed` tracking, the convergence invariant).

This is a *smaller* change than building a dedicated criteria editor, and it matches the
mental model: criteria are just markdown in the file.

### Scope

- **In scope:** databank ADR editor and the on-disk format for ADR criteria.
- **Out of scope:** editing criteria on loops (no persistence endpoint exists; it touches
  the running cascade and the convergence invariant — a separate follow-up if wanted).
  Loop display (`LoopNode.tsx`, `LoopPage.tsx`) is unaffected.

## Approach

### 1. Remove the read-only panel (the core fix)

`AdrEditor.tsx`:
- Delete the local `AcceptanceCriteria` component (lines 144-168) and its render site
  (line 137).
- `readAdr` already returns `body` **with** the `## Acceptance criteria` section
  included (`filesService.ts:79-87`), and the markdown editor already renders that body.
  So once the read-only panel is gone, criteria are edited inline in the existing editor.
- The BlockNote markdown editor renders `- [ ]` items as real, clickable checkboxes, so
  the criteria section reads and edits as a normal checklist inside the doc.

No new component. The `AdrDoc.acceptanceCriteria` field stays in the type and keeps being
parsed server-side (the planner needs it).

### 2. Plain on-disk format for ADR criteria

`src/shared/criteriaMarkdown.ts` (see §3 for the move):
- Add a serialization style. ADR writes render **plain**: `- [ ] text`, or `- [x] text`
  when passed, plus an optional `— verify: \`cmd\`` when a verify command is present.
  **No `**ac-N**` id, no `🔒`.**
- Loop writes keep the **full** format (ids, `🔒`, verify) — loops rely on stable ids,
  locked enforcement, and per-criterion `passed`.
- Implementation: parametrize `upsertCriteriaInBody` / `renderCriterion` with a
  `style: 'plain' | 'full'` option (default `'full'` to preserve loop behavior). For
  `'plain'`, skip `assignMissingIds` and skip id/lock rendering.

Round-trip: a user types `- [ ] the feature works`, saves, and it serializes back to
`- [ ] the feature works` — no mutation, no injected ids.

Parsing is unchanged and already tolerant: `parseCriteriaFromBody` treats the id, verify,
and lock segments as optional, so plain lines parse into `{ id: '', text, passed }`.

### 3. Move the parser to shared (single source of truth)

Move `src/server/files/criteriaMarkdown.ts` → `src/shared/criteriaMarkdown.ts`. It is
pure string logic (only imports the `AcceptanceCriterion` type, no Node deps), so server
and web import one parser. Update imports (`filesService.ts`, `mock.ts`, and tests).
Re-export from `src/shared/index` if that is the established barrel pattern.

> Note: the web side does not strictly need the parser for this design (criteria are
> edited as raw markdown in the body), but the move removes the server-only coupling and
> is cheap. If review prefers minimal churn, this step can be dropped without affecting
> the user-visible behavior.

### 4. Assign ids when seeding loops from ADRs

Because plain ADRs no longer store ids, the **offline planner** must assign them when it
seeds loop criteria. `real.ts:154` currently maps `adr.acceptanceCriteria` straight
through with `id: c.id` (now empty). Wrap with the existing `assignMissingIds` helper so
each seeded loop criterion gets a stable `ac-N`.

The LLM-planner path already handles this (`prompt.ts:253` falls back to `ac-${ci+1}`),
so only the offline path needs the change.

## Migration

Existing `databank/*.md` self-ADRs currently carry `**ac-N**` ids and `🔒`. They migrate
**lazily**: the next save of an ADR re-serializes it in plain form. This matches the
existing "disk migrates on next write" pattern (`filesService.ts:73-82`). No bulk
migration script.

- Dropping ids is safe: ids are reassigned at loop-seed time.
- Dropping `🔒` (locked) on ADRs is safe: locked is **not** propagated from ADRs to loops
  today (`real.ts:154` carries only `{id, text, verify}`), so locked-on-an-ADR is already
  dead data.
- `verify` is preserved (the planner carries it).

Running cascades are unaffected — they read loop files under `cascades/`, not databank
ADRs.

## Error handling & edge cases

- **BlockNote round-trip:** the criteria section already lives in the edited body today,
  so BlockNote already round-trips it; plain format is strictly simpler and safer.
- **Assistant rail:** `registerOpenDoc` keeps reporting the full body (criteria included)
  as context; inline-apply is unchanged. No regression — criteria were already in the body.
- **Empty criteria section:** `upsertCriteriaInBody` already removes the section when the
  list is empty.
- **A criterion with a backtick in verify:** existing guard in `renderCriterion` still
  applies in both styles.

## Testing

- `criteriaMarkdown.test.ts`: add cases for `style: 'plain'` — no ids/lock emitted, verify
  preserved, `[x]`/`[ ]` honored; confirm `'full'` output is unchanged (loop path).
- `filesService` ADR write test: saving an ADR with criteria produces plain markdown and
  round-trips without mutation; legacy `**ac-N**`/`🔒` input migrates to plain on write.
- `real.ts` offline-planner test: seeded loop criteria get assigned `ac-N` ids when the
  ADR stored none.
- `AdrEditor` test/manual: read-only panel is gone; editing the criteria checklist in the
  body persists via save.

## Out-of-scope follow-up (noted, not built)

Editing criteria on loops would need: a `PUT` cascade/loop endpoint, a `writeLoop`
persistence path, and guardrails so criteria can't be mutated mid-run in a way that
desyncs `passed` or violates the convergence invariant. Tracked separately.
