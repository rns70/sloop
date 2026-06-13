# Warn on Missing Acceptance Criteria Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface a non-blocking warning whenever a design (ADR) or loop has no acceptance criteria, and add an "Add with assistant" shortcut on the ADR editor that drafts the section via the existing propose → inline-diff flow.

**Architecture:** A single pure rule (`bodyHasNoCriteria`) and the warning/instruction copy live in `src/shared/criteriaMarkdown.ts` (the canonical home for the criteria format). A reusable amber `CriteriaWarning` component renders the notice. The ADR editor computes the rule live from the editor body and shows a banner (with the assistant button) and a compact badge; the read-only loop page shows a banner linking to its source ADR. The assistant shortcut is wired through `AssistantContext` so the editor's button reuses the assistant rail's existing request/propose/apply machinery — no new API and no silent writes.

**Tech Stack:** TypeScript, React, React Router, Vitest (node environment, `.test.ts` only — there is no jsdom/RTL harness, so logic is unit-tested and React wiring is verified via `npm run typecheck` + manual check).

---

## Testing note (read before starting)

The repo's Vitest config is `environment: 'node'` and `include: ['src/**/*.test.ts']`. There are **zero React component tests** and no Testing Library/jsdom. Therefore:

- The pure rule `bodyHasNoCriteria` is fully unit-tested (Task 1).
- React changes (Tasks 2–6) are verified with `npm run typecheck` and `npm test` (must stay green) plus a manual browser check at the end. Do **not** add an RTL/jsdom harness — that is out of scope.

Verification commands used throughout:
- `npm test` → runs Vitest once (`vitest run`).
- `npm run typecheck` → `tsc -p tsconfig.json --noEmit`.

Ignore any pre-existing TypeScript errors under `src/eval/**` — that module has unrelated missing-dependency errors and is not part of this work.

---

## File Structure

- **Create** `src/web/design/CriteriaWarning.tsx` — the reusable amber notice component.
- **Modify** `src/shared/criteriaMarkdown.ts` — add `MISSING_CRITERIA_WARNING`, `CRITERIA_ASSISTANT_INSTRUCTION`, `bodyHasNoCriteria`.
- **Modify** `src/shared/criteriaMarkdown.test.ts` — unit tests for `bodyHasNoCriteria`.
- **Modify** `src/web/design/index.ts` — export `CriteriaWarning`.
- **Modify** `src/web/assistant/AssistantContext.tsx` — add `runAssistant` + `registerRunner`.
- **Modify** `src/web/shell/AssistantRail.tsx` — `run(textArg?)` + register a runner on mount.
- **Modify** `src/web/views/databank/AdrEditor.tsx` — banner, badge, assistant button.
- **Modify** `src/web/views/loop/LoopPage.tsx` — banner + source-ADR link.

---

## Task 1: Shared rule + copy (`bodyHasNoCriteria`)

**Files:**
- Modify: `src/shared/criteriaMarkdown.ts`
- Test: `src/shared/criteriaMarkdown.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/shared/criteriaMarkdown.test.ts` (the file already imports `describe, it, expect` from `vitest`). Add `bodyHasNoCriteria` to the existing import from `./criteriaMarkdown`:

```ts
import {
  parseCriteriaFromBody,
  upsertCriteriaInBody,
  assignMissingIds,
  CRITERIA_HEADING,
  bodyHasNoCriteria,
} from './criteriaMarkdown';
```

Then add this block at the end of the file:

```ts
describe('bodyHasNoCriteria', () => {
  it('is true when there is no criteria section at all', () => {
    expect(bodyHasNoCriteria('# Title\n\nProse only.\n')).toBe(true);
  });

  it('is true when the section heading exists but has no items', () => {
    expect(bodyHasNoCriteria('# Title\n\n## Acceptance criteria\n\n')).toBe(true);
  });

  it('is false when the section has at least one item', () => {
    expect(bodyHasNoCriteria('## Acceptance criteria\n\n- [ ] It works\n')).toBe(false);
  });

  it('is true when the only checklist lives inside a fenced code block', () => {
    const body = '## Acceptance criteria\n\n```\n- [ ] not a real criterion\n```\n';
    expect(bodyHasNoCriteria(body)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/shared/criteriaMarkdown.test.ts`
Expected: FAIL — `bodyHasNoCriteria is not a function` / import has no exported member `bodyHasNoCriteria`.

- [ ] **Step 3: Implement the additions**

Append to the end of `src/shared/criteriaMarkdown.ts`:

```ts
/** UI copy shown when a design/loop has no acceptance criteria. Single source of truth. */
export const MISSING_CRITERIA_WARNING =
  'This design has no acceptance criteria. Add a "## Acceptance criteria" checklist so loops seeded from it can be verified.';

/** Instruction handed to the assistant by the "Add with assistant" shortcut. */
export const CRITERIA_ASSISTANT_INSTRUCTION =
  'Add a `## Acceptance criteria` section to this design as a markdown checklist. ' +
  'Each item must be objectively verifiable; where a shell command can check it, ' +
  'append " — verify: `<command>`". Base the criteria on the document\'s decision and consequences.';

/**
 * True when the markdown body carries no acceptance criteria — i.e. the section is
 * absent OR present but empty. Reuses the canonical parser, so checklist lines inside
 * fenced code blocks do not count.
 */
export function bodyHasNoCriteria(body: string): boolean {
  return parseCriteriaFromBody(body).criteria.length === 0;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/shared/criteriaMarkdown.test.ts`
Expected: PASS — all four new cases green, existing cases unaffected.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no new errors (ignore pre-existing `src/eval/**` errors).

- [ ] **Step 6: Commit**

```bash
git add src/shared/criteriaMarkdown.ts src/shared/criteriaMarkdown.test.ts
git commit -m "feat(criteria): add bodyHasNoCriteria rule and warning copy"
```

---

## Task 2: `CriteriaWarning` component

**Files:**
- Create: `src/web/design/CriteriaWarning.tsx`
- Modify: `src/web/design/index.ts`

No unit test (no component test harness — see Testing note). Verified via typecheck and the manual check in Task 7.

- [ ] **Step 1: Create the component**

Create `src/web/design/CriteriaWarning.tsx`:

```tsx
import type { ReactNode } from 'react';
import { MISSING_CRITERIA_WARNING } from '../../shared/index';
import { cx } from './cx';

interface CriteriaWarningProps {
  /** 'banner' = full-width notice; 'badge' = compact inline indicator. */
  variant?: 'banner' | 'badge';
  /** Optional trailing slot, e.g. the "Add with assistant" button or a source-ADR link. */
  action?: ReactNode;
  className?: string;
}

/**
 * Non-blocking amber notice shown when a design/loop has no acceptance criteria.
 * Amber (not status red) signals caution rather than error. The message is the
 * shared single source of truth (`MISSING_CRITERIA_WARNING`).
 */
export function CriteriaWarning({ variant = 'banner', action, className }: CriteriaWarningProps) {
  if (variant === 'badge') {
    return (
      <span
        role="status"
        title={MISSING_CRITERIA_WARNING}
        className={cx(
          'inline-flex items-center gap-1 rounded bg-role-amberBg px-1.5 py-0.5 text-[11px] font-medium text-role-amber',
          className,
        )}
      >
        <span aria-hidden>⚠</span> No acceptance criteria
      </span>
    );
  }
  return (
    <div
      role="status"
      className={cx(
        'mb-4 flex items-start gap-2 rounded-md bg-role-amberBg px-3 py-2 text-[12.5px] text-role-amber',
        className,
      )}
    >
      <span aria-hidden className="mt-px">⚠</span>
      <span className="flex-1">{MISSING_CRITERIA_WARNING}</span>
      {action && <span className="shrink-0">{action}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Export from the design barrel**

In `src/web/design/index.ts`, add alongside the other component exports (e.g. just after the `Button` export line):

```ts
export { CriteriaWarning } from './CriteriaWarning';
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no new errors. (Confirms `bg-role-amberBg`/`text-role-amber` are valid; these classes are already used by the `amber` tone in `src/web/design/tokens.ts`.)

- [ ] **Step 4: Commit**

```bash
git add src/web/design/CriteriaWarning.tsx src/web/design/index.ts
git commit -m "feat(design): add CriteriaWarning notice component"
```

---

## Task 3: Assistant context channel (`runAssistant` / `registerRunner`)

**Files:**
- Modify: `src/web/assistant/AssistantContext.tsx`

- [ ] **Step 1: Add a ref + the two methods**

Replace the body of `AssistantContext.tsx` with the version below. Changes: import `useRef`; extend the interface with `runAssistant` and `registerRunner`; store the runner in a ref; expose both through the provider value.

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * The open editor (if any) registers itself here so the shell-mounted AssistantRail can:
 *  - auto-include the current doc as context, and
 *  - hand an edit of THAT doc back to the editor's inline accept/reject diff (`applyInline`)
 *    instead of writing through the API.
 *
 * It also exposes a one-way channel (`runAssistant`/`registerRunner`) so UI elsewhere —
 * e.g. the missing-criteria shortcut — can trigger an assistant run that surfaces in the
 * rail as a normal proposal. The rail registers the runner on mount; `runAssistant` is a
 * no-op when no rail is mounted.
 */
export interface OpenDoc {
  relPath: string;
  getValue: () => string;
  applyInline: (originalText: string, replacement: string) => void;
}

interface AssistantContextValue {
  openDoc: OpenDoc | null;
  registerOpenDoc: (doc: OpenDoc | null) => void;
  runAssistant: (instruction: string) => void;
  registerRunner: (fn: ((instruction: string) => void) | null) => void;
}

const Ctx = createContext<AssistantContextValue | null>(null);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [openDoc, setOpenDoc] = useState<OpenDoc | null>(null);
  const registerOpenDoc = useCallback((doc: OpenDoc | null) => setOpenDoc(doc), []);

  const runnerRef = useRef<((instruction: string) => void) | null>(null);
  const registerRunner = useCallback(
    (fn: ((instruction: string) => void) | null) => {
      runnerRef.current = fn;
    },
    [],
  );
  const runAssistant = useCallback((instruction: string) => {
    runnerRef.current?.(instruction);
  }, []);

  const value = useMemo(
    () => ({ openDoc, registerOpenDoc, runAssistant, registerRunner }),
    [openDoc, registerOpenDoc, runAssistant, registerRunner],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAssistant(): AssistantContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAssistant must be used within an AssistantProvider');
  return ctx;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no new errors. (`AssistantRail` and `AdrEditor` still compile — they don't yet use the new methods.)

- [ ] **Step 3: Commit**

```bash
git add src/web/assistant/AssistantContext.tsx
git commit -m "feat(assistant): add runAssistant channel to AssistantContext"
```

---

## Task 4: Wire the rail to the runner

**Files:**
- Modify: `src/web/shell/AssistantRail.tsx`

The rail must (a) let `run` accept an explicit instruction, and (b) register a runner so external callers trigger a run. To avoid stale-closure bugs, keep the latest `run` in a ref and register a stable wrapper once.

- [ ] **Step 1: Add `useEffect`/`useRef` imports and pull `registerRunner` from context**

At the top of `AssistantRail.tsx`, ensure the React import includes `useEffect` and `useRef` (it already imports `useMemo, useState`):

```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
```

Change the context destructure (currently `const { openDoc } = useAssistant();`) to:

```tsx
  const { openDoc, registerRunner } = useAssistant();
```

- [ ] **Step 2: Make `run` accept an optional instruction**

Replace the existing `run` function with this version (adds the `textArg` parameter; when provided, it also reflects the text into the textarea):

```tsx
  async function run(textArg?: string) {
    const text = (textArg ?? instruction).trim();
    if (!text || busy) return;
    if (textArg !== undefined) setInstruction(textArg);
    setBusy(true); setError(null); setNote(null); setProposal(null);
    try {
      setProposal(await requestAssistant({ instruction: text, contextPaths, model: alias || undefined }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }
```

The existing Send button (`onClick={() => void run()}`) is unchanged — calling with no argument preserves current behaviour.

- [ ] **Step 3: Register the runner (stale-closure-safe)**

Immediately after the `run` function declaration, add a ref that always points at the latest `run`, plus a one-time registration effect:

```tsx
  // Keep the latest run() so the registered runner never calls a stale closure
  // (run captures contextPaths/alias/instruction/busy, which change across renders).
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    registerRunner((text) => void runRef.current(text));
    return () => registerRunner(null);
  }, [registerRunner]);
```

- [ ] **Step 4: Typecheck and test**

Run: `npm run typecheck`
Expected: no new errors.
Run: `npm test`
Expected: PASS (no behavioural test changes; existing suite stays green).

- [ ] **Step 5: Commit**

```bash
git add src/web/shell/AssistantRail.tsx
git commit -m "feat(assistant): let the rail run an externally supplied instruction"
```

---

## Task 5: ADR editor — banner, badge, assistant button

**Files:**
- Modify: `src/web/views/databank/AdrEditor.tsx`

Design note: the button is intentionally **not** disabled while the assistant is busy — the editor cannot observe the rail's `busy` state, and the rail's `run` already early-returns when `busy`, so concurrent triggers are de-duplicated there.

- [ ] **Step 1: Add imports**

Add a shared import (new line near the other imports):

```tsx
import { bodyHasNoCriteria, CRITERIA_ASSISTANT_INSTRUCTION } from '../../../shared/index';
```

Add `CriteriaWarning` to the existing design import:

```tsx
import { Button, CriteriaWarning, EditableTitle, MarkdownEditor, Page, cx, type MarkdownEditorHandle } from '../../design/index';
```

- [ ] **Step 2: Pull `runAssistant` from context**

Change the existing `const { registerOpenDoc } = useAssistant();` to:

```tsx
  const { registerOpenDoc, runAssistant } = useAssistant();
```

- [ ] **Step 3: Compute the live flag**

Add next to the existing `dirty` derivation (around the `const dirty = …` line):

```tsx
  const missingCriteria = bodyHasNoCriteria(body);
```

- [ ] **Step 4: Add the badge to the page actions**

In the `actions={ adr && ( … ) }` JSX, add the badge before the `{toggle}` so it sits next to Save:

```tsx
      actions={
        adr && (
          <>
            {missingCriteria && <CriteriaWarning variant="badge" />}
            {toggle}
            <Button variant="primary" onClick={() => void save()} disabled={!dirty || saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        )
      }
```

- [ ] **Step 5: Add the banner below the title (edit mode only)**

In the `{adr && ( … )}` body block, insert the banner between the file-path `<div>` and the `{mode === 'edit' ? … }` editor block:

```tsx
          <EditableTitle value={title} onChange={setTitle} autoFocus={isNew} />
          <div className="mb-5 mt-1 font-mono text-[12px] text-ink-faint">{file}</div>

          {mode === 'edit' && missingCriteria && (
            <CriteriaWarning
              action={
                <Button variant="subtle" onClick={() => runAssistant(CRITERIA_ASSISTANT_INSTRUCTION)}>
                  Add with assistant
                </Button>
              }
            />
          )}

          {mode === 'edit' ? (
            <MarkdownEditor ref={editorRef} value={body} onChange={setBody} />
          ) : (
            <InlineDiff before={committed} after={body} />
          )}
```

- [ ] **Step 6: Typecheck and test**

Run: `npm run typecheck`
Expected: no new errors.
Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/web/views/databank/AdrEditor.tsx
git commit -m "feat(databank): warn + assistant shortcut when an ADR has no criteria"
```

---

## Task 6: Loop page — banner + source-ADR link

**Files:**
- Modify: `src/web/views/loop/LoopPage.tsx`

The loop page is read-only. When criteria are empty it shows the banner; when a `sourceAdr` id is present it resolves that id to the ADR's `relPath` via `getAdrs()` and links to the editor, falling back to the databank index if the ADR can't be found.

- [ ] **Step 1: Add imports and `useState`/`useEffect`**

Update the React/router imports and add `getAdrs`/`CriteriaWarning`:

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getAdrs, type LoopStatus } from '../../api-client/index';
import { PropertyRow, StatusDot, Tag, roleTone, CriteriaWarning } from '../../design/index';
```

(Keep the other existing imports — `Page`, `useCascade`, `humanizeCascade`, `loopTitle`, `useRoleLabel`, `OutputStream` — unchanged.)

- [ ] **Step 2: Resolve the source-ADR path (before the early returns)**

`current` is already computed near the top via `const current = loopById(loopId);`, before the `if (error)` / `if (!detail)` / `if (!current)` returns. Immediately after that line, add the resolver effect (hooks must run before any early return):

```tsx
  const sourceAdr = current?.frontmatter.sourceAdr;
  const [sourceAdrPath, setSourceAdrPath] = useState<string | null>(null);
  useEffect(() => {
    if (!sourceAdr) {
      setSourceAdrPath(null);
      return;
    }
    let cancelled = false;
    getAdrs()
      .then((adrs) => {
        if (!cancelled) setSourceAdrPath(adrs.find((a) => a.id === sourceAdr)?.relPath ?? null);
      })
      .catch(() => {
        if (!cancelled) setSourceAdrPath(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sourceAdr]);
```

- [ ] **Step 3: Compute the missing flag**

Where the criteria are derived (`const criteria = fm.acceptanceCriteria ?? [];`), add directly below it:

```tsx
  const missingCriteria = criteria.length === 0;
```

- [ ] **Step 4: Render the banner when criteria are missing**

Replace the existing criteria section (the `{criteria.length > 0 && ( … )}` block) with a branch that always renders the section header and shows either the list or the banner:

```tsx
      <section className="mt-6">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.05em] text-ink-faint">
          Acceptance criteria
        </div>
        {missingCriteria ? (
          <CriteriaWarning
            action={
              sourceAdr ? (
                <Link
                  to={
                    sourceAdrPath
                      ? `/databank/${sourceAdrPath.replace(/^databank\//, '')}`
                      : '/databank'
                  }
                  className="whitespace-nowrap text-accent hover:underline"
                >
                  Add criteria on {sourceAdr.toUpperCase()}
                </Link>
              ) : undefined
            }
          />
        ) : (
          <ul className="space-y-1 text-[13.5px]">
            {criteria.map((cr) => (
              <li key={cr.id} className="flex items-baseline gap-2">
                <span className={cr.passed ? 'text-status-done' : 'text-ink-subtle'}>
                  {cr.passed ? '✓' : '○'}
                </span>
                <span className="text-ink-muted">{cr.text}</span>
                {cr.verify && (
                  <span className="ml-auto whitespace-nowrap font-mono text-[11.5px] text-ink-faint">
                    verify: {cr.verify}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
```

Note: the criteria-count `PropertyRow` higher up (`{criteria.length > 0 && (<PropertyRow label="Criteria">…)}`) stays as-is — it correctly hides when there are no criteria.

- [ ] **Step 5: Typecheck and test**

Run: `npm run typecheck`
Expected: no new errors.
Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/views/loop/LoopPage.tsx
git commit -m "feat(loop): warn + link to source ADR when a loop has no criteria"
```

---

## Task 7: Manual verification

**Files:** none (verification only).

- [ ] **Step 1: Full suite + typecheck**

Run: `npm test`
Expected: PASS (whole suite).
Run: `npm run typecheck`
Expected: no new errors (ignore pre-existing `src/eval/**`).

- [ ] **Step 2: Run the app and verify the four behaviours**

Start the app (`npm run dev`) and check:

1. Open an ADR with no `## Acceptance criteria` (e.g. create a new one in the databank): the amber banner appears below the title and the badge appears next to Save. Save is still enabled.
2. Type a criterion line (`- [ ] something`) into the body: banner and badge disappear immediately (live).
3. Click **Add with assistant** on a criteria-less ADR (with a model/key configured): the assistant rail runs and shows a proposal editing this ADR; clicking **Apply** lands it as an inline accept/reject diff. (If no key is configured, the rail shows its existing key-missing error — expected.)
4. Open a loop with no acceptance criteria: the banner shows under "Acceptance criteria"; if the loop has a `sourceAdr`, the "Add criteria on ADR-XXX" link navigates to that ADR's editor (or to the databank index if the ADR isn't found).

- [ ] **Step 3: No code commit expected here**

Tasks 1–6 already committed their changes.

---

## Self-Review

- **Spec coverage:** rule + copy (Task 1) ✓; `CriteriaWarning` banner/badge (Task 2) ✓; ADR editor live banner + badge + assistant button (Task 5) ✓; loop page banner + source-ADR link (Task 6) ✓; assistant channel reuse (Tasks 3–4) ✓; warn-only/non-blocking (Save never disabled, server untouched) ✓; tests for `bodyHasNoCriteria` incl. fenced-code case (Task 1) ✓.
- **Deviations from spec (intentional, called out at hand-off):** (a) component-level RTL tests are replaced by typecheck + manual verification because the repo has no jsdom/RTL harness and `vitest` includes only `.test.ts`; (b) the assistant button is not disabled-on-busy (editor can't see rail `busy`; the rail's own guard dedupes); (c) the loop link resolves `sourceAdr` id→path via `getAdrs()` with a databank-index fallback (the spec assumed a direct path was available).
- **Type consistency:** `bodyHasNoCriteria(string): boolean`, `runAssistant(string): void`, `registerRunner(fn|null): void`, `run(textArg?: string)`, `CriteriaWarning` props `{ variant?, action?, className? }` — names used identically across Tasks 1–6.
- **Placeholders:** none — every code step shows complete content.

---

# ⚠️ REVISION 2026-06-13 — assistant subsystem replaced (chat API)

**Context:** Mid-execution, an `assistant-chatbot` branch was merged into the base. The single-shot assistant (`requestAssistant` → `AssistantProposal` → `AssistantRail.run()` → `openDoc.applyInline` inline diff) **no longer exists**. The assistant is now a **streaming chatbot**:

- `useAssistantChat({ model?, onWrote? }): { messages, streaming, error, send, stop }` (`src/web/assistant/useAssistantChat.ts`). `send(text)` appends a user turn, streams the agent, and the agent **writes files directly via its own tools** (no inline diff). On completion, written paths are passed to `onWrote(paths)`.
- `streamAssistant({ messages, model }, onEvent)` (`src/web/api-client/index.ts`) — request carries the full thread; there are **no `contextPaths`**. The agent decides which file to edit from the instruction text.
- `AssistantRail` owns the hook locally and only uses `openDoc` for a "Context:" label.

**Tasks 1 & 2 are unaffected and already committed.** Task 6 is unaffected (loop criteria still come from `fm.acceptanceCriteria`). **Tasks 3–5 below SUPERSEDE their originals above.**

All work happens in the worktree `.claude/worktrees/warn-criteria` (branch `feat/warn-criteria`). Verification: `npm test` for logic; for typecheck use a scoped grep on the touched files — HEAD carries unrelated pre-existing errors (`src/eval/**`, `src/server/api/real.ts`, `src/server/index.ts`) that must be IGNORED.

## Task 3 (REVISED): Assistant context channel

**Files:** Modify `src/web/assistant/AssistantContext.tsx`

Unchanged in shape from the original — add a one-way trigger channel. Extend `AssistantContextValue` with:
- `runAssistant: (instruction: string) => void` — forwards to a registered runner; no-op if none.
- `registerRunner: (fn: ((instruction: string) => void) | null) => void`.

Implement with a `useRef` for the runner (so registering doesn't re-render) and `useCallback` for both methods; add both to the `useMemo` value. (Same code as the original Task 3 block above — it does not depend on the old assistant API.)

Commit: `feat(assistant): add runAssistant channel to AssistantContext`

## Task 4 (REVISED): Wire the rail's chat `send` to the runner

**Files:** Modify `src/web/shell/AssistantRail.tsx`

The rail already destructures `{ messages, streaming, error, send, stop } = useAssistantChat(...)`. Register a runner that forwards to `send` (which already guards against empty text / concurrent sends via `sendingRef`).

- Add `useRef` to the React import (already imports `useEffect, useRef, useState` — confirm `useRef` present).
- Change `const { openDoc } = useAssistant();` to `const { openDoc, registerRunner } = useAssistant();`.
- After the `useAssistantChat` destructure, add a ref to the latest `send` + a one-time registration effect (stale-closure-safe, since `send` is re-created when `messages`/`model` change):

```tsx
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    registerRunner((text) => void sendRef.current(text));
    return () => registerRunner(null);
  }, [registerRunner]);
```

Optional nicety: the runner may also mirror the instruction into the draft box for visibility, but it is NOT required — `send` does not read `draft`. Keep it minimal: just call `send`.

Commit: `feat(assistant): let external callers trigger a chat send`

## Task 5 (REVISED): ADR editor — banner, badge, assistant button (chat)

**Files:** Modify `src/web/views/databank/AdrEditor.tsx`

Banner + badge are unchanged from the original Task 5 (live `bodyHasNoCriteria(body)` flag, `CriteriaWarning` banner below the title in edit mode, compact badge next to Save). **Only the assistant button changes:**

Because the chat agent writes the file on disk (no editor-buffer diff) and receives no implicit context, the click handler must (a) persist the current buffer first so the agent edits the latest content, and (b) hand the agent an instruction that explicitly names the target file.

- Import: `import { bodyHasNoCriteria, CRITERIA_ASSISTANT_INSTRUCTION } from '../../../shared/index';` and add `CriteriaWarning` to the design import.
- Pull `runAssistant`: `const { registerOpenDoc, runAssistant } = useAssistant();`.
- Live flag: `const missingCriteria = bodyHasNoCriteria(body);`.
- Button handler (save-then-send, path-scoped instruction):

```tsx
            <Button
              variant="subtle"
              onClick={async () => {
                await save(); // persist buffer so the agent edits the latest on-disk content
                runAssistant(`Edit the design file \`${relPath}\`. ${CRITERIA_ASSISTANT_INSTRUCTION}`);
              }}
            >
              Add with assistant
            </Button>
```

(`save()` and `relPath` already exist in the component. `save()` is async and safe to await; it no-ops nothing harmful when not dirty.)

**Known v1 limitation (call out at hand-off, do not over-build):** after the agent writes the open ADR, the editor buffer does not auto-refresh — the rail's `onWrote` navigates, but navigating to the already-open path does not re-fetch. The user sees the write in the chat (tool activity) and the banner clears on next load/navigation. A live refetch (e.g. bumping a reload nonce when the assistant writes the open doc's path) is deferred unless the user wants it now.

Badge accessibility note (from Task 2 review): banner and badge co-render on this page; both currently use `role="status"`. Leave as-is for v1 (static content; only announced on change).

Commit: `feat(databank): warn + chat shortcut when an ADR has no criteria`

## Task 6: unchanged (see original above)

## Task 7: unchanged (final review + manual verification), but verify behaviour against the CHAT flow:
- Clicking "Add with assistant" saves, then posts a message in the assistant rail that names the file; the agent streams and writes the ADR; tool activity shows in the chat.
- Confirm the warning clears after reload/navigation.
