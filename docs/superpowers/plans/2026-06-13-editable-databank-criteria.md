# Editable Databank Acceptance Criteria — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make databank ADR acceptance criteria feel like plain, editable markdown — remove the read-only panel and store criteria as plain checklist items (`- [ ] text`), keeping the structured `**ac-N**`/`🔒` machinery only for loops.

**Architecture:** Criteria already live in the ADR markdown body; the friction is a read-only display panel plus a machine-oriented on-disk format. We (1) move the criteria markdown parser into `src/shared` so it has one home, (2) add a `'plain' | 'full'` serialization style, (3) make ADR read/write use `'plain'` while loops keep `'full'`, (4) assign ids when the offline planner seeds a loop from an ADR (since plain ADRs no longer store ids), and (5) delete the read-only panel in the editor.

**Tech Stack:** TypeScript, React (BlockNote markdown editor), Express, Vitest. Spec: `docs/superpowers/specs/2026-06-13-editable-databank-criteria-design.md`.

---

## File structure

- `src/shared/criteriaMarkdown.ts` — **moved** from `src/server/files/`. The single parser/serializer for the criteria section. Gains a `CriteriaStyle` param.
- `src/shared/criteriaMarkdown.test.ts` — **moved** alongside it. Gains `'plain'` cases.
- `src/shared/index.ts` — re-exports the parser.
- `src/server/files/filesService.ts` — `readAdr`/`writeAdr` serialize ADR criteria as `'plain'`; `writeLoop` stays `'full'`. Import path updated.
- `src/server/api/mock.ts` — import path updated.
- `src/server/api/real.ts` — offline planner assigns ids when seeding leaf criteria from an ADR.
- `fixtures/sample-workspace/databank/adr-007-token-rotation.md` — converted to the new plain format (demonstrates it + drives the real.ts test).
- `src/web/views/databank/AdrEditor.tsx` — read-only `AcceptanceCriteria` panel removed.
- Tests updated: `src/server/files/filesService.test.ts`, `src/server/api/real.test.ts`.

---

## Task 1: Move the criteria parser into `src/shared`

Pure refactor (no behavior change). The module only depends on the `AcceptanceCriterion` type, so it belongs in shared where both server and web can import it.

**Files:**
- Move: `src/server/files/criteriaMarkdown.ts` → `src/shared/criteriaMarkdown.ts`
- Move: `src/server/files/criteriaMarkdown.test.ts` → `src/shared/criteriaMarkdown.test.ts`
- Modify: `src/shared/index.ts`
- Modify: `src/server/files/filesService.ts:14`
- Modify: `src/server/api/mock.ts:22`

- [ ] **Step 1: Move both files with git (preserves history)**

```bash
git mv src/server/files/criteriaMarkdown.ts src/shared/criteriaMarkdown.ts
git mv src/server/files/criteriaMarkdown.test.ts src/shared/criteriaMarkdown.test.ts
```

- [ ] **Step 2: Fix the type import inside the moved module**

In `src/shared/criteriaMarkdown.ts`, change the first import (it now lives in `src/shared`, so the type is a sibling):

```ts
// was: import type { AcceptanceCriterion } from '../../shared';
import type { AcceptanceCriterion } from './types';
```

- [ ] **Step 3: Fix the type import inside the moved test**

In `src/shared/criteriaMarkdown.test.ts`, change:

```ts
// was: import type { AcceptanceCriterion } from '../../shared';
import type { AcceptanceCriterion } from './types';
```

(The `import { ... } from './criteriaMarkdown';` line stays correct — the test sits next to the module.)

- [ ] **Step 4: Re-export the parser from the shared barrel**

In `src/shared/index.ts`, add a line after the existing exports:

```ts
export * from './types';
export * from './services';
export { resolveModel } from './resolveModel';
export * from './criteriaMarkdown';
```

- [ ] **Step 5: Update the server import in `filesService.ts:14`**

```ts
// was: import { parseCriteriaFromBody, upsertCriteriaInBody } from './criteriaMarkdown';
import { parseCriteriaFromBody, upsertCriteriaInBody } from '../../shared';
```

- [ ] **Step 6: Update the server import in `mock.ts:22`**

```ts
// was: import { parseCriteriaFromBody } from '../files/criteriaMarkdown';
import { parseCriteriaFromBody } from '../../shared';
```

- [ ] **Step 7: Typecheck + run the moved test (expect green — pure move)**

Run: `npm run typecheck && npx vitest run src/shared/criteriaMarkdown.test.ts`
Expected: typecheck passes; all existing criteriaMarkdown tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/shared/criteriaMarkdown.ts src/shared/criteriaMarkdown.test.ts src/shared/index.ts src/server/files/filesService.ts src/server/api/mock.ts
git commit -m "refactor: move criteriaMarkdown parser into src/shared"
```

---

## Task 2: Add a `'plain' | 'full'` serialization style

TDD. Default stays `'full'` so loop behavior is unchanged. `'plain'` drops `**ac-N**` ids and `🔒`, keeps the checkbox and an optional `— verify:` command, and does **not** auto-assign ids.

**Files:**
- Modify: `src/shared/criteriaMarkdown.ts`
- Test: `src/shared/criteriaMarkdown.test.ts`

- [ ] **Step 1: Write failing tests for plain rendering**

Append to `src/shared/criteriaMarkdown.test.ts` (the `ac()` helper at the top of the file is already in scope):

```ts
describe('upsertCriteriaInBody — plain style', () => {
  it('renders plain checklist items: no id, no lock, keeps checkbox + verify', () => {
    const out = upsertCriteriaInBody(
      '# T\n',
      [
        ac({ id: 'ac-1', text: 'It works', passed: false, locked: true }),
        ac({ id: 'ac-2', text: 'Tests pass', passed: true, verify: 'npm test' }),
      ],
      'plain',
    );
    expect(out).toBe(
      '# T\n\n' +
        CRITERIA_HEADING +
        '\n\n- [ ] It works\n- [x] Tests pass — verify: `npm test`\n',
    );
  });

  it('does not assign ids in plain style (empty id stays empty)', () => {
    const out = upsertCriteriaInBody('', [ac({ id: '', text: 'A' })], 'plain');
    expect(out).toBe(CRITERIA_HEADING + '\n\n- [ ] A\n');
  });

  it('full style is unchanged (default) — still emits **ac-N** and 🔒', () => {
    const out = upsertCriteriaInBody('', [ac({ id: 'ac-1', text: 'A', locked: true })]);
    expect(out).toBe(CRITERIA_HEADING + '\n\n- [ ] **ac-1** A 🔒\n');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/criteriaMarkdown.test.ts`
Expected: FAIL — `upsertCriteriaInBody` does not accept a third argument yet, so plain output still contains `**ac-1**`.

- [ ] **Step 3: Implement the `style` parameter**

In `src/shared/criteriaMarkdown.ts`, replace `upsertCriteriaInBody` and `renderCriterion` (currently lines 100-119) with:

```ts
export type CriteriaStyle = 'plain' | 'full';

/** Replace (or append, or remove-if-empty) the criteria section in a body.
 *  `full` (default) emits ids + 🔒 for loops; `plain` emits a bare checklist for ADRs. */
export function upsertCriteriaInBody(
  body: string,
  criteriaIn: AcceptanceCriterion[],
  style: CriteriaStyle = 'full',
): string {
  const { bodyWithoutSection } = parseCriteriaFromBody(body);
  const base = bodyWithoutSection.trim();
  // Stable ids only matter for the structured (loop) format; plain leaves them alone.
  const criteria = style === 'full' ? assignMissingIds(criteriaIn) : criteriaIn;
  if (criteria.length === 0) return base ? `${base}\n` : '';
  const section = `${CRITERIA_HEADING}\n\n${criteria.map((c) => renderCriterion(c, style)).join('\n')}`;
  return `${base ? `${base}\n\n` : ''}${section}\n`;
}

function renderCriterion(c: AcceptanceCriterion, style: CriteriaStyle): string {
  const id = style === 'full' && c.id ? `**${c.id}** ` : '';
  let line = `- [${c.passed ? 'x' : ' '}] ${id}${c.text}`.trimEnd();
  if (c.verify) {
    if (c.verify.includes('`')) {
      throw new Error(`verify command must not contain a backtick: ${c.verify}`);
    }
    line += ` — verify: \`${c.verify}\``;
  }
  if (style === 'full' && c.locked) line += ' 🔒';
  return line;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/shared/criteriaMarkdown.test.ts`
Expected: PASS — including the unchanged full-style cases.

- [ ] **Step 5: Commit**

```bash
git add src/shared/criteriaMarkdown.ts src/shared/criteriaMarkdown.test.ts
git commit -m "feat: plain serialization style for acceptance criteria"
```

---

## Task 3: ADR read/write uses the plain style

TDD via updating the existing ADR round-trip tests to the new expected output, then flipping `readAdr`/`writeAdr` to `'plain'`. Loops (`writeLoop`) stay `'full'`.

**Files:**
- Modify: `src/server/files/filesService.ts:93` (readAdr body injection) and `:111` (writeAdr)
- Test: `src/server/files/filesService.test.ts` (three existing ADR tests)

- [ ] **Step 1: Update the three affected ADR tests to expect plain output**

In `src/server/files/filesService.test.ts`:

**(a) The `adr-099` round-trip test — replace lines 94-98** (the assertions block) with:

```ts
    // Field round-trips (text + passed); ADRs no longer persist ids, so id is empty.
    expect(readBack.acceptanceCriteria).toEqual([{ id: '', text: 'Holds', passed: false }]);
    expect(readBack.body).toContain('Context.');
    expect(readBack.body).toContain('## Acceptance criteria');
    expect(readBack.body).toContain('- [ ] Holds');
    expect(readBack.body).not.toContain('**ac-1**');
```

**(b) The `adr-101` "body wins" test — replace line 181** with:

```ts
    expect(readBack.acceptanceCriteria).toEqual([{ id: '', text: 'From body', passed: true }]);
```

**(c) The `adr-legacy` migration test — replace lines 232 and 240.**

Line 232 becomes (plain body has the text but no id markup):

```ts
    expect(read.body).toContain('- [ ] old style');
    expect(read.body).not.toContain('**ac-1**');
```

Line 240 becomes (ADRs drop the lock glyph on disk — locked is not used by ADRs):

```ts
    expect(raw).not.toContain('🔒');
```

- [ ] **Step 2: Run the ADR tests to verify they fail**

Run: `npx vitest run src/server/files/filesService.test.ts`
Expected: FAIL — current code still writes `**ac-1**`/`🔒` for ADRs, so the new `not.toContain` / `- [ ] Holds` assertions fail.

- [ ] **Step 3: Make `writeAdr` serialize plain**

In `src/server/files/filesService.ts`, change line 111 inside `writeAdr`:

```ts
    // ADR criteria are a plain checklist; ids/lock belong to loops only.
    const body = upsertCriteriaInBody(doc.body, criteria, 'plain');
```

- [ ] **Step 4: Make `readAdr` inject plain when migrating legacy frontmatter**

In `src/server/files/filesService.ts`, change line 93 inside `readAdr`:

```ts
      outBody = upsertCriteriaInBody(body, acceptanceCriteria, 'plain');
```

- [ ] **Step 5: Run the full filesService suite to verify green**

Run: `npx vitest run src/server/files/filesService.test.ts`
Expected: PASS. (The loop test at line 53 and the locked-frontmatter read test at 139-159 are unaffected — `writeLoop` still uses `'full'`, and the locked read pulls from frontmatter, not body.)

- [ ] **Step 6: Commit**

```bash
git add src/server/files/filesService.ts src/server/files/filesService.test.ts
git commit -m "feat: store databank ADR criteria as plain markdown"
```

---

## Task 4: Assign ids when the offline planner seeds a loop from an ADR

Plain ADRs carry empty ids. The offline (dry-run) planner copies ADR criteria straight into loop criteria, so it must assign stable `ac-N` ids there. We also convert the sample-workspace fixture ADR to the plain format and assert the planner backfills ids.

**Files:**
- Modify: `src/server/api/real.ts:154`
- Modify: `fixtures/sample-workspace/databank/adr-007-token-rotation.md`
- Test: `src/server/api/real.test.ts`

- [ ] **Step 1: Convert the sample ADR fixture to plain format**

Replace lines 21-27 of `fixtures/sample-workspace/databank/adr-007-token-rotation.md` (the note + criteria) with:

```markdown
> Acceptance criteria are plain checklist items; each may carry a `verify` command
> (exit 0 = passed) that the implementing loop runs.

## Acceptance criteria

- [ ] Refresh tokens rotate on every use and expire within ≤15 minutes. — verify: `npm test -- rotation`
- [ ] A refresh token presented twice (reuse) is rejected and the session is revoked. — verify: `npm test -- reuse-detection`
```

(The `real.test.ts` setup mutates `≤15 minutes` → `≤10 minutes` to create the diff; that substring is still in the first criterion, so the diff still fires.)

- [ ] **Step 2: Add the id-assignment import to `real.ts`**

In `src/server/api/real.ts`, add `assignMissingIds` to the existing shared import at line 30:

```ts
import { resolveModel, assignMissingIds } from '../../shared/index';
```

- [ ] **Step 3: Write the failing assertion in the existing dry-run test**

In `src/server/api/real.test.ts`, inside the `'converges: ...'` test, immediately after line 88 (`expect(leaves[0].frontmatter.acceptanceCriteria.length).toBe(2);`) add:

```ts
    // Plain ADR criteria carry no ids on disk; the planner backfills stable ones.
    expect(leaves[0].frontmatter.acceptanceCriteria.map((c) => c.id)).toEqual(['ac-1', 'ac-2']);
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run src/server/api/real.test.ts`
Expected: FAIL — seeded criteria ids are empty strings (from the plain fixture), so they do not equal `['ac-1', 'ac-2']`.

- [ ] **Step 5: Assign ids when seeding leaf criteria**

In `src/server/api/real.ts`, replace the `acceptanceCriteria` mapping (lines 154-158) with:

```ts
          acceptanceCriteria: assignMissingIds(adr.acceptanceCriteria).map((c) => ({
            id: c.id,
            text: c.text,
            verify: c.verify,
          })),
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/server/api/real.test.ts`
Expected: PASS — including the existing convergence assertions (criteria still verify to `passed: true`).

- [ ] **Step 7: Commit**

```bash
git add src/server/api/real.ts src/server/api/real.test.ts fixtures/sample-workspace/databank/adr-007-token-rotation.md
git commit -m "feat: backfill criterion ids when seeding loops from plain ADRs"
```

---

## Task 5: Remove the read-only criteria panel from the ADR editor

This is the user-visible fix: with the panel gone, criteria are edited inline in the markdown body (BlockNote renders `- [ ]` as clickable checkboxes). No new component.

**Files:**
- Modify: `src/web/views/databank/AdrEditor.tsx`

- [ ] **Step 1: Remove the panel render site**

In `src/web/views/databank/AdrEditor.tsx`, delete line 137 (the render of the panel):

```tsx
          <AcceptanceCriteria adr={adr} />
```

So the block becomes:

```tsx
          {mode === 'edit' ? (
            <MarkdownEditor ref={editorRef} value={body} onChange={setBody} />
          ) : (
            <InlineDiff before={committed} after={body} />
          )}
        </>
      )}
```

- [ ] **Step 2: Delete the now-unused `AcceptanceCriteria` component**

Delete the entire `function AcceptanceCriteria({ adr }: { adr: AdrDoc }) { ... }` definition (lines 144-168), including the blank line before it.

- [ ] **Step 3: Typecheck (catches unused imports / dangling refs)**

Run: `npm run typecheck`
Expected: PASS. `AdrDoc` is still imported and used by `useState<AdrDoc | null>` and `save()`, so its import stays. If typecheck reports any *other* now-unused symbol, remove it.

- [ ] **Step 4: Build the web bundle to confirm no runtime/JSX breakage**

Run: `npm run build`
Expected: PASS (tsc + vite build succeed).

- [ ] **Step 5: Manual verification**

Start the app, open a databank ADR, and confirm:
- The criteria appear once, as an editable `## Acceptance criteria` checklist inside the editor (no separate read-only panel below).
- Editing/adding/removing a criterion line and clicking **Save** persists; reopening shows the change.
- The saved file under `databank/` contains plain `- [ ] text` lines (no `**ac-N**`, no `🔒`).

(Use the project's run skill / `npm run dev` per the repo's usual flow.)

- [ ] **Step 6: Commit**

```bash
git add src/web/views/databank/AdrEditor.tsx
git commit -m "feat: edit databank criteria inline; remove read-only panel"
```

---

## Final verification

- [ ] **Run the whole suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Typecheck + build once more**

Run: `npm run typecheck && npm run build`
Expected: both PASS.

---

## Notes for the implementer

- **Why ids leave ADRs but stay on loops:** loops use ids for stable identity across reorder, `passed` tracking, and the convergence invariant. Design-doc ADRs don't run anything; the planner reassigns ids when an ADR becomes a loop (`prompt.ts:253` for the LLM path, Task 4 for the offline path).
- **`locked` on ADRs was already dead data** — `real.ts` never propagated it to loops — so dropping `🔒` from the ADR on-disk format loses nothing.
- **Loops are intentionally untouched.** Editing criteria on a running loop needs a new endpoint + convergence guardrails; it's a separate follow-up (see spec, "Out-of-scope follow-up").
