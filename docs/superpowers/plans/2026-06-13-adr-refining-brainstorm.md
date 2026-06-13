# ADR Refining-Brainstorm Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the sloop assistant run a superpowers-style refining brainstorm (one question per turn, recap-and-gate before writing) when creating or substantially changing an ADR, while leaving all other actions immediate.

**Architecture:** Purely a system-prompt addition. The assistant is a prompt-driven, tool-using agent loop (`src/server/assistant/agent.ts`) that ends a turn whenever the model emits text without a tool call. So "ask one question and stop" and "recap and wait" need no new plumbing — only new prompt guidance. We add a named `ADR_REFINEMENT_PROTOCOL` block to `prompt.ts` and assert its invariants in `prompt.test.ts`.

**Tech Stack:** TypeScript, Vitest. No new dependencies. No web/tools/agent changes.

---

## File Structure

- **Modify:** `src/server/assistant/prompt.ts` — add the `ADR_REFINEMENT_PROTOCOL` constant and compose it into the `SYSTEM` array. Single responsibility (prompt construction) is unchanged.
- **Modify:** `src/server/assistant/prompt.test.ts` — add a test asserting the protocol's invariants; keep all existing assertions.

No other files change.

---

### Task 1: Add the refining-brainstorm protocol to the system prompt (TDD)

**Files:**
- Modify: `src/server/assistant/prompt.ts`
- Test: `src/server/assistant/prompt.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/server/assistant/prompt.test.ts`, add this test inside the existing `describe('buildAssistantSystemPrompt', ...)` block, after the `mandates the ADR template` test:

```ts
  it('defines the refining-brainstorm protocol for ADR create/substantial-change', () => {
    const s = buildAssistantSystemPrompt();
    // Names the skill and its one-question-at-a-time discipline.
    expect(s).toMatch(/refining brainstorm/i);
    expect(s).toMatch(/one .*question at a time/i);
    // Covers all four dimensions.
    expect(s).toMatch(/problem|motivation/i);
    expect(s).toMatch(/decision/i);
    expect(s).toMatch(/consequences|trade-?offs/i);
    expect(s).toMatch(/acceptance criteria/i);
    // Has the recap/confirm-before-writing gate.
    expect(s).toMatch(/recap/i);
    expect(s).toMatch(/before .*writ/i);
    // Still scopes immediate writes for trivial/non-ADR work (boundary preserved).
    expect(s).toContain('apply immediately');
    expect(s).toMatch(/typo|trivial|small/i);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/assistant/prompt.test.ts -t "refining-brainstorm"`
Expected: FAIL — the new assertions (e.g. `/refining brainstorm/i`) do not match the current prompt.

- [ ] **Step 3: Add the protocol constant**

In `src/server/assistant/prompt.ts`, after the `ADR_TEMPLATE` constant definition (ends at the line `].join('\n');` around line 27) and before `const SYSTEM = [`, insert:

```ts
/**
 * Superpowers-style refining brainstorm the assistant runs when creating or substantially
 * changing an ADR. ADRs are requirements (the contract a cascade reconciles against), so
 * they must be sharp. The agent loop ends a turn whenever the model emits text without a
 * tool call, so "ask one question and stop" and "recap and wait" need no extra plumbing —
 * this guidance alone drives the behavior. Scoped as the explicit exception to the
 * default "writes apply immediately" rule; trivial/non-ADR work stays immediate.
 */
const ADR_REFINEMENT_PROTOCOL = [
  'Refining ADRs (refining brainstorm). ADRs are requirements — the contract a cascade',
  'reconciles against — so they must be sharp. When the user asks you to CREATE a new ADR or',
  'SUBSTANTIALLY change an existing one, do NOT write it immediately. Run a refining brainstorm:',
  '  1. If editing an existing ADR, read_doc it first.',
  '  2. Ask ONE clarifying question at a time (never a batch). Work through, as needed:',
  '     - Problem & motivation: why this requirement exists; the real problem and constraints.',
  '     - The decision: the normative requirement; scope boundaries; alternatives rejected.',
  '     - Consequences: trade-offs, impacts, follow-on effects.',
  '     - Acceptance criteria: each must be objectively verifiable; prefer a shell `verify:`',
  '       command. Push back on vague or unverifiable criteria.',
  '     Skip a dimension only when the user has already made it unambiguous.',
  '  3. When you have enough, RECAP the proposed ADR (title + Context / Decision / Consequences /',
  '     Acceptance criteria) and ask the user to confirm or adjust. Do not write yet.',
  '  4. Only AFTER the user gives a go-ahead, call create_adr (new) or edit_doc (existing),',
  '     following the ADR template. Preserve existing criteria when editing.',
  'This protocol applies ONLY to creating or substantially rewriting an ADR. Plain questions,',
  'roles, workflows, and small/mechanical ADR edits (fix a typo, reword one line, rename a',
  'heading) apply immediately as before — do not interrogate the user over a trivial change.',
].join('\n');
```

- [ ] **Step 4: Compose the protocol into the SYSTEM prompt**

In the same file, in the `SYSTEM` array, replace the final paragraph block:

```ts
  'Writes apply immediately — there is no confirmation step. Prefer reading a document',
  'before editing it. Keep replies concise; describe what you changed. When the user just',
  'wants an answer, reply in plain markdown without calling a tool.',
].join('\n');
```

with:

```ts
  'Writes apply immediately — there is no confirmation step, EXCEPT for the ADR refining',
  'brainstorm described below. Prefer reading a document before editing it. Keep replies',
  'concise; describe what you changed. When the user just wants an answer, reply in plain',
  'markdown without calling a tool.',
  '',
  ADR_REFINEMENT_PROTOCOL,
].join('\n');
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/server/assistant/prompt.test.ts`
Expected: PASS — the new test and all pre-existing tests (template, tools, `apply immediately`, `pickAssistantAlias`) pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/assistant/prompt.ts src/server/assistant/prompt.test.ts
git commit -m "feat(assistant): refining-brainstorm protocol for ADR create/change"
```

---

## Self-Review

**Spec coverage:**
- Auto-trigger on ADR create/substantial-change → Step 3 protocol intro + Step 4 exception wording. ✓
- One question per turn → protocol item 2 + test `/one .*question at a time/i`. ✓
- Four dimensions (problem, decision, consequences, verifiable criteria) → protocol item 2 bullets + test assertions. ✓
- Recap gate before writing → protocol items 3–4 + test `/recap/i` and `/before .*writ/i`. ✓
- Non-ADR / trivial edits stay immediate → protocol closing paragraph + test `apply immediately` and `/typo|trivial|small/i`. ✓
- No new tools/UI/stream events; only `prompt.ts` changes → File Structure. ✓

**Placeholder scan:** No TBD/TODO; all code shown verbatim. ✓

**Type consistency:** No new types or signatures introduced. `buildAssistantSystemPrompt()` signature unchanged; `ADR_REFINEMENT_PROTOCOL` is a module-private `const string` consumed only by the `SYSTEM` array. ✓
