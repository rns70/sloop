# Acceptance criteria as editable markdown

**Date:** 2026-06-13
**Status:** Approved (design)
**Scope:** Databank ADRs *and* cascade loops

## Problem

Acceptance criteria currently live in YAML **frontmatter** (`acceptanceCriteria[]`) on
both ADR files (`databank/*.md`) and loop files (`cascades/{id}/*.md`). In the databank
editor they render as a **read-only section** appended below the markdown editor
(`src/web/views/databank/AdrEditor.tsx:116,123-147`). The body is editable; the criteria
are not.

We want acceptance criteria to be **part of the markdown document body** — read and edited
as part of the document, not quarantined in frontmatter and shown as a separate read-only
box. They must remain **easily and reliably writeable by agents**.

The tension: criteria are not cosmetic. Each carries structured, machine-consumed fields —
`id` (stable, referenced across loops/ADRs), `text`, `verify` (a shell command), `passed`
(flipped by the engine during runs), and `locked` (architect-authored, must not be
weakened). Moving them into prose must not lose these fields.

## Decisions

1. **Source of truth: the markdown body, parsed.** Criteria live as a section in the body
   and are parsed back into structured `AcceptanceCriterion[]` on read.
2. **Scope: ADRs and loops both.** Same format and code path for both file kinds.
3. **Convention: visible ids, one line per criterion** (see below). Chosen because the
   databank editor is BlockNote (block-based rich text) and exports via
   `blocksToMarkdownLossy` (`src/web/design/MarkdownEditor.tsx:106`). HTML comments do **not**
   survive a BlockNote round-trip, so hidden-id-in-comment conventions are unviable. What
   *does* survive: task-list checkboxes, **bold**, inline `code`, and emoji. A flat
   (non-nested) list is used because nested-list-under-checkbox fidelity is the most likely
   thing to break on lossy export.
4. **Authoring path: through a writer/serializer.** Agents and code produce structured
   `AcceptanceCriterion[]`; a single serializer renders the canonical markdown. Format
   correctness is guaranteed by code — agents cannot emit a malformed criteria section. No
   standalone authoring skill is needed (would be redundant); reference docs only.

## The on-disk convention

A criterion is one task-list item under a `## Acceptance criteria` heading:

```markdown
## Acceptance criteria

- [ ] **ac-1** Refresh tokens rotate on every use and expire within ≤15 minutes. — verify: `npm test -- rotation` 🔒
- [x] **ac-2** Old tokens are rejected after rotation. — verify: `npm test -- reject-old`
```

Parsing rules, per list item under the heading:

| Marker | Field |
|---|---|
| `- [ ]` / `- [x]` (case-insensitive) | `passed` (false / true) |
| leading `**ac-N**` | `id` (stable; survives reorder/edit) |
| `— verify: ` followed by an inline-code span | `verify` (optional) |
| trailing 🔒 | `locked` (optional) |
| remaining text between the id and the `— verify`/🔒 markers | `text` |

Notes:
- `verify` and `locked` are optional and independently present.
- Text is whatever remains after stripping the recognised markers; minor whitespace
  normalisation from the editor is tolerated.

## Architecture

### New module: `src/server/files/criteriaMarkdown.ts`

The single source of truth for the format. Pure, browser-free, fully unit-testable:

- `parseCriteriaFromBody(body: string): { criteria: AcceptanceCriterion[]; bodyWithoutSection: string }`
  - Extracts the `## Acceptance criteria` section and returns parsed criteria plus the body
    with that section removed (so callers can recombine deterministically).
- `upsertCriteriaInBody(body: string, criteria: AcceptanceCriterion[]): string`
  - Renders / replaces the `## Acceptance criteria` section, leaving the rest of the body
    byte-for-byte intact. Appends the section if absent. Omits the section entirely when
    `criteria` is empty.
  - **This is "the writer."** Every write path routes criteria through it.
- id assignment: when serializing a criterion whose `id` is empty (a newly authored bullet),
  assign the next free `ac-N` (max existing N + 1) and persist it.

### Wiring into `filesService` (the only behavioural change)

The in-memory shapes are unchanged — `AdrDoc.acceptanceCriteria` and
`LoopDoc.frontmatter.acceptanceCriteria` stay `AcceptanceCriterion[]`. Planner, engine, and
UI status displays are untouched; they keep reading the same field.

- `readAdr` (`src/server/files/filesService.ts:55`): parse criteria from the body via
  `parseCriteriaFromBody`. **Fallback + migration injection:** if the body has no
  `## Acceptance criteria` section, take criteria from `normalizeCriteria(data.acceptanceCriteria)`
  (frontmatter) **and** inject a canonical section into the returned `body` so the editor shows
  them immediately. Lazy migration: disk migrates on the next write.
- `writeAdr` (`:67`): the **body is the source** for ADRs (the editor edits the body). Parse
  the body; if it has a criteria section, use those criteria; if not, fall back to the
  `doc.acceptanceCriteria` field (covers programmatic creation, e.g. `createItem.ts:82`).
  Assign ids to any criterion missing one. Re-serialize the section canonically into the body
  and drop `acceptanceCriteria` from frontmatter. The stale field is otherwise ignored.
- `readLoop` (`:76`): after `parseFrontmatter`, parse criteria from the body into
  `data.acceptanceCriteria` (frontmatter fallback when no section; no body injection needed —
  loops aren't body-edited).
- `writeLoop` (`:82`): the **structured field is the source** for loops (the engine mutates
  `loop.frontmatter.acceptanceCriteria[].passed`). Serialize that field into the body via
  `upsertCriteriaInBody` and drop `acceptanceCriteria` from frontmatter.

**Why the asymmetry:** ADRs are edited body-first by a human in BlockNote, so the body is
authoritative on write. Loops are mutated field-first by the engine (no body editing), so the
structured array is authoritative. Both converge on the same on-disk format.

Because server-side serialization is exact string manipulation (no BlockNote), the engine
flipping `passed` mid-run rewrites only the criteria section and never disturbs the rest of
the body. Lossiness is confined to the human (BlockNote) editor.

### Engine / executor

No source changes to the engine or executor logic — they mutate
`loop.frontmatter.acceptanceCriteria[].passed` and call `writeLoop` exactly as today. The
new `writeLoop` serializes those mutations into the body section transparently.

## Migration

- **Lazy:** the frontmatter fallback in `readAdr`/`readLoop` keeps old files working; each
  file migrates to the body format on its next write.
- **Fixtures:** convert committed examples to the new format so canonical samples are
  correct:
  - `fixtures/sample-workspace/databank/*.md`
  - `fixtures/sample-workspace/cascades/*/*.md` (loop files with criteria)

## UI changes

- `src/web/views/databank/AdrEditor.tsx`: remove the read-only `AcceptanceCriteria`
  component and its render (lines 116, 123-147). Criteria are now part of the body the
  editor already shows and edits. The save path already round-trips the body; no special
  criteria handling is needed in the component.
- Read-only status displays elsewhere (Mission Control `LoopNode`, `CascadeView`,
  `LoopPage`) are unchanged — they still read `frontmatter.acceptanceCriteria`.

## Reference documentation

- A module-level doc comment in `criteriaMarkdown.ts` documenting the canonical format and
  parse rules.
- A short note under `docs/` describing the format for humans/agents.
- **No standalone skill.** Authoring goes through the serializer, so a skill would be
  redundant. Revisit only if free-writing agents ever bypass the writer.

## Testing

- **Unit (`criteriaMarkdown.test.ts`):** parse round-trips, idempotent
  `upsert(parse(...))`, id auto-assignment, empty section handling, optional
  `verify`/`locked` permutations, body preservation outside the section, frontmatter
  fallback.
- **filesService:** `readAdr`/`writeAdr`/`readLoop`/`writeLoop` round-trip criteria through
  the body; frontmatter no longer contains `acceptanceCriteria` after write; lazy-migration
  fallback reads legacy frontmatter files.
- **Engine:** existing `cascadeEngine`/executor tests stay green; add a check that a
  `passed` flip persists into the body section and leaves surrounding body intact.
- **BlockNote fidelity (validation step):** capture BlockNote's actual exported markdown for
  a representative criterion line (`- [ ] **ac-1** text — verify: \`cmd\` 🔒`) and assert the
  parser recovers the structured fields from that real output. Make the parser tolerant of
  the whitespace/escaping BlockNote actually emits.

## Risks

- **BlockNote lossy export reformats the criteria line** beyond what the parser tolerates.
  Mitigation: the BlockNote-fidelity validation step above; flat single-line format chosen
  specifically to minimise this.
- **id stability under heavy editing.** Ids are visible (`**ac-N**`); reordering preserves
  them. Deleting the id token causes reassignment of a new id on save — acceptable and
  visible to the author.
