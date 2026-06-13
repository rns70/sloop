# Warn on missing acceptance criteria (with assistant shortcut)

**Date:** 2026-06-13
**Status:** Approved (design)

## Problem

Design markdown files — ADRs in the databank — are meant to carry a
`## Acceptance criteria` checklist. The loops seeded from an ADR copy those
criteria and verify against them. Today nothing flags an ADR (or a loop) that
has no criteria, so designs silently ship un-verifiable and loops run with
nothing to check.

We want to **surface** the gap, not prevent work. The warning is **non-blocking**:
saving is never disabled and the server is unchanged. We also add a one-click
**"Add with assistant"** shortcut on the ADR editor that drafts the section for
the user to review.

## Scope

- **In scope:** a visible warning in the ADR editor and on the loop page when
  acceptance criteria are absent or empty; an assistant shortcut on the ADR
  editor that proposes a criteria section via the existing propose → inline-diff
  flow.
- **Out of scope:** server-side rejection of writes without criteria; editing
  loops (loops are read-only views); any change to the on-disk markdown format;
  a new assistant API endpoint.

## The rule (single source of truth)

"Missing" means **absent OR empty** — which collapses to a single test: the
parsed criteria list has zero items. Detection logic and warning copy live in
`src/shared/criteriaMarkdown.ts`, already the canonical home for the criteria
format, so the UI and any future consumer never drift.

New exports in `src/shared/criteriaMarkdown.ts`:

- `MISSING_CRITERIA_WARNING: string` — the warning message. Draft copy:
  > "This design has no acceptance criteria. Add a `## Acceptance criteria`
  > checklist so loops seeded from it can be verified."
- `CRITERIA_ASSISTANT_INSTRUCTION: string` — the instruction handed to the
  assistant. Draft copy:
  > "Add a `## Acceptance criteria` section to this design as a markdown
  > checklist. Each item must be objectively verifiable; where a shell command
  > can check it, append ` — verify: \`<command>\``. Base the criteria on the
  > document's decision and consequences."
- `bodyHasNoCriteria(body: string): boolean` — returns
  `parseCriteriaFromBody(body).criteria.length === 0`. Pure and testable; reuses
  the existing parser (so fenced-code-block false positives are already handled).

The loop page checks its in-memory frontmatter array length directly
(`acceptanceCriteria.length === 0`) — there is no body to parse there.

## Components and wiring

### 1. `CriteriaWarning` (design system)

A small reusable amber callout in `src/web/design/`, exported from
`src/web/design/index.ts`. Amber (existing `role-amber` / `role-amberBg` tokens)
signals caution and is deliberately distinct from `status-failed` red, which
means error. Props:

- `variant: 'banner' | 'badge'` — full-width banner vs. compact inline indicator.
- `action?: ReactNode` — optional trailing slot (the assistant button, or the
  "Add criteria on ADR-xxx" link on the loop page).

It renders an icon + `MISSING_CRITERIA_WARNING`. No state of its own.

### 2. `AdrEditor.tsx` — editable, live

- Compute `const missingCriteria = bodyHasNoCriteria(body)` on each render, so it
  reflects the live editor body and clears the instant a criterion is added.
- Render a full-width `CriteriaWarning` banner below `EditableTitle`, with an
  **"Add with assistant"** button in its `action` slot.
- Render a compact `CriteriaWarning` badge next to the Save button in the page
  `actions`.
- Save stays fully enabled regardless (non-blocking).

### 3. `LoopPage.tsx` — read-only view

- `const missingCriteria = criteria.length === 0`.
- Replace the current `criteria.length > 0 &&` guard on the criteria section:
  when criteria exist, render the list as today; when missing, render a
  `CriteriaWarning` banner instead of rendering nothing.
- When `fm.sourceAdr` is present, the banner's `action` slot is a link to that
  ADR ("Add criteria on `ADR-007`") — loops can't be edited here, so it points
  the user to where the fix belongs. No assistant button on this page.

### 4. Assistant shortcut wiring

The banner button (in `AdrEditor`) and the assistant rail
(`src/web/shell/AssistantRail.tsx`) are separate components; they communicate
through `AssistantContext`.

`AssistantContext` gains:

- `runAssistant(instruction: string): void` — callable by anyone; forwards to a
  registered runner. No-op if the rail isn't mounted.
- `registerRunner(fn: ((instruction: string) => void) | null): void` — the rail
  registers its runner on mount and clears it on unmount.

`AssistantRail`:

- `run()` is refactored to accept an optional explicit text argument:
  `run(textArg?: string)` uses `textArg ?? instruction`. (Current behaviour
  unchanged when called with no argument.)
- On mount, registers a runner: `(text) => { setInstruction(text); void run(text); }`.

`AdrEditor` banner button: `onClick={() => runAssistant(CRITERIA_ASSISTANT_INSTRUCTION)}`,
`disabled` while the assistant is busy.

Because the ADR editor already registers itself as `openDoc`, the rail's
`contextPaths` is the open ADR, and the returned proposal is an `edit` of that
doc. The user reviews it and applies it through the **existing inline
accept/reject diff** — the same human gate as a typed request. Nothing is
written silently.

## Data flow

```
AdrEditor body --bodyHasNoCriteria--> missingCriteria --> <CriteriaWarning>
                                                              |
                                          "Add with assistant" button
                                                              |
                                              runAssistant(INSTRUCTION)
                                                              |
                                   AssistantContext --> registered runner
                                                              |
                              AssistantRail.run(INSTRUCTION) --> requestAssistant
                                                              |
                                   proposal (edit of open ADR) shown in rail
                                                              |
                                   user clicks Apply --> openDoc.applyInline (inline diff)
```

## Error handling

- Detection is a pure function over an in-memory string — no I/O, no new failure
  modes.
- The server write path is untouched; warn-only by design.
- Assistant shortcut: button disabled while `busy`; missing model/API key is
  already surfaced by the rail's existing error states; `runAssistant` is a
  no-op if no runner is registered (rail unmounted).

## Testing

- **Unit (`src/shared/criteriaMarkdown.test.ts`):** `bodyHasNoCriteria` for
  absent section, empty section, section with items, and a checklist that
  appears only inside a fenced code block (must still count as missing).
- **Component:** `CriteriaWarning` renders the message for both variants and
  exposes the `action` slot. `AdrEditor` shows the banner + badge when the body
  has no criteria and hides them once a criterion is present (live). `LoopPage`
  shows the banner when criteria are empty, the list when present, and the
  source-ADR link when `fm.sourceAdr` is set. Match existing repo test
  conventions.
- **Assistant wiring:** clicking "Add with assistant" calls `runAssistant` with
  `CRITERIA_ASSISTANT_INSTRUCTION`; the registered runner forwards to `run`.

## Files touched

- `src/shared/criteriaMarkdown.ts` — add `MISSING_CRITERIA_WARNING`,
  `CRITERIA_ASSISTANT_INSTRUCTION`, `bodyHasNoCriteria`.
- `src/shared/criteriaMarkdown.test.ts` — tests for `bodyHasNoCriteria`.
- `src/web/design/CriteriaWarning.tsx` (new) + export in `src/web/design/index.ts`.
- `src/web/assistant/AssistantContext.tsx` — `runAssistant` + `registerRunner`.
- `src/web/shell/AssistantRail.tsx` — `run(textArg?)` + register runner on mount.
- `src/web/views/databank/AdrEditor.tsx` — banner, badge, assistant button.
- `src/web/views/loop/LoopPage.tsx` — banner + source-ADR link.
- Component tests alongside the above per repo convention.
