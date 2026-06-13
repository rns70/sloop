# Acceptance Criteria as Editable Markdown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move acceptance criteria out of YAML frontmatter and into the markdown body of ADR and loop files as a parsed `## Acceptance criteria` task list, so they read and edit as part of the document, while keeping the structured `verify`/`passed`/`locked` data the cascade engine depends on.

**Architecture:** A single pure module (`criteriaMarkdown.ts`) owns the on-disk format — parsing a body's criteria section into `AcceptanceCriterion[]` and serializing criteria back into the body. `FilesService` read/write routes criteria through it; the in-memory `AcceptanceCriterion[]` shape is unchanged, so the planner, engine, and UI status displays are untouched. ADRs are body-authoritative on write (human edits the body); loops are field-authoritative (the engine mutates the structured array). The mock backend's self-contained loaders parse the same format.

**Tech Stack:** TypeScript, Node, Vitest, gray-matter, React (BlockNote editor), Express.

---

## Background facts (read before starting)

- `AcceptanceCriterion` (`src/shared/types.ts:7-13`): `{ id: string; text: string; verify?: string; locked?: boolean; passed: boolean }`.
- `serializeFrontmatter(data, body)` (`src/server/files/frontmatter.ts:28`) prunes `undefined` keys and round-trips stably.
- ADR write call sites both flow through `FilesService.writeAdr`:
  - `src/web/shell/createItem.ts:82` creates a new ADR with `acceptanceCriteria: []` and a placeholder body (no criteria section).
  - `src/web/views/databank/AdrEditor.tsx:77` saves `{ ...adr, body }` (the field is stale; the body is the edited truth).
- Loop write call sites are all in the engine (`src/server/cascade/cascadeEngine.ts:138,139,296,312,322`) and mutate `loop.frontmatter.acceptanceCriteria` then call `writeLoop`.
- The mock backend (`src/server/api/mock.ts`) has its **own** markdown loaders (`loadAdrs:29`, `loadCascade:94`) that read `data.acceptanceCriteria` from frontmatter — these must be updated too.
- Test command: `npx vitest run <file>` for one file; `npm test` for all. Typecheck: `npm run typecheck`.

## File Structure

- **Create** `src/server/files/criteriaMarkdown.ts` — format SSOT: `parseCriteriaFromBody`, `upsertCriteriaInBody`, `assignMissingIds`, `CRITERIA_HEADING`.
- **Create** `src/server/files/criteriaMarkdown.test.ts` — unit + tolerance tests.
- **Modify** `src/server/files/filesService.ts` — `readAdr`/`writeAdr`/`readLoop`/`writeLoop`.
- **Modify** `src/server/files/filesService.test.ts` — update ADR + loop round-trip expectations.
- **Modify** `src/server/api/mock.ts` — `loadAdrs`/`loadCascade` parse criteria from body.
- **Modify** `src/web/views/databank/AdrEditor.tsx` — remove the read-only criteria section.
- **Create** `scripts/migrate-criteria.ts` — one-shot migration (read+rewrite every ADR/loop).
- **Modify** fixtures under `fixtures/sample-workspace/databank/` and `fixtures/sample-workspace/cascades/` — migrated by the script.

---

### Task 1: The format module (`criteriaMarkdown.ts`)

**Files:**
- Create: `src/server/files/criteriaMarkdown.ts`
- Test: `src/server/files/criteriaMarkdown.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/server/files/criteriaMarkdown.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { AcceptanceCriterion } from '../../shared';
import {
  parseCriteriaFromBody,
  upsertCriteriaInBody,
  assignMissingIds,
  CRITERIA_HEADING,
} from './criteriaMarkdown';

const ac = (over: Partial<AcceptanceCriterion>): AcceptanceCriterion => ({
  id: 'ac-1',
  text: 'It works',
  passed: false,
  ...over,
});

describe('parseCriteriaFromBody', () => {
  it('returns no section when the heading is absent', () => {
    const r = parseCriteriaFromBody('# Title\n\nProse only.\n');
    expect(r.hasSection).toBe(false);
    expect(r.criteria).toEqual([]);
    expect(r.bodyWithoutSection).toBe('# Title\n\nProse only.');
  });

  it('parses id, text, passed, verify, and locked', () => {
    const body = [
      '# Title',
      '',
      'Prose.',
      '',
      CRITERIA_HEADING,
      '',
      '- [ ] **ac-1** Tokens rotate on every use. — verify: `npm test -- rotation` 🔒',
      '- [x] **ac-2** Old tokens are rejected.',
    ].join('\n');
    const r = parseCriteriaFromBody(body);
    expect(r.hasSection).toBe(true);
    expect(r.bodyWithoutSection).toBe('# Title\n\nProse.');
    expect(r.criteria).toEqual([
      { id: 'ac-1', text: 'Tokens rotate on every use.', passed: false, verify: 'npm test -- rotation', locked: true },
      { id: 'ac-2', text: 'Old tokens are rejected.', passed: true },
    ]);
  });

  it('stops the section at the next heading', () => {
    const body = [
      CRITERIA_HEADING,
      '',
      '- [ ] **ac-1** A.',
      '',
      '## Notes',
      '',
      'after',
    ].join('\n');
    const r = parseCriteriaFromBody(body);
    expect(r.criteria).toHaveLength(1);
    expect(r.bodyWithoutSection).toBe('## Notes\n\nafter');
  });
});

describe('assignMissingIds', () => {
  it('fills empty ids with the next free ac-N', () => {
    const out = assignMissingIds([
      ac({ id: 'ac-1' }),
      ac({ id: '', text: 'new one' }),
      ac({ id: 'ac-3' }),
      ac({ id: '   ', text: 'another' }),
    ]);
    expect(out.map((c) => c.id)).toEqual(['ac-1', 'ac-4', 'ac-3', 'ac-5']);
  });
});

describe('upsertCriteriaInBody', () => {
  it('appends a section when none exists', () => {
    const out = upsertCriteriaInBody('# Title\n\nProse.', [
      ac({ id: 'ac-1', text: 'A', verify: 'cmd' }),
    ]);
    expect(out).toBe(
      '# Title\n\nProse.\n\n' + CRITERIA_HEADING + '\n\n- [ ] **ac-1** A — verify: `cmd`\n',
    );
  });

  it('replaces an existing section in place', () => {
    const start = '# T\n\n' + CRITERIA_HEADING + '\n\n- [ ] **ac-1** Old\n';
    const out = upsertCriteriaInBody(start, [ac({ id: 'ac-1', text: 'New', passed: true })]);
    expect(out).toBe('# T\n\n' + CRITERIA_HEADING + '\n\n- [x] **ac-1** New\n');
  });

  it('removes the section when criteria is empty', () => {
    const start = '# T\n\n' + CRITERIA_HEADING + '\n\n- [ ] **ac-1** Old\n';
    expect(upsertCriteriaInBody(start, [])).toBe('# T\n');
  });

  it('assigns ids to criteria that lack them', () => {
    const out = upsertCriteriaInBody('', [ac({ id: '', text: 'first' })]);
    expect(out).toBe(CRITERIA_HEADING + '\n\n- [ ] **ac-1** first\n');
  });

  it('is idempotent (round-trips through parse)', () => {
    const once = upsertCriteriaInBody('# T\n\nProse.', [
      ac({ id: 'ac-1', text: 'A', verify: 'cmd', locked: true }),
      ac({ id: 'ac-2', text: 'B', passed: true }),
    ]);
    const parsed = parseCriteriaFromBody(once);
    const twice = upsertCriteriaInBody(once, parsed.criteria);
    expect(twice).toBe(once);
  });
});

describe('parser tolerance (BlockNote-style output)', () => {
  it('accepts an en-dash or hyphen before verify', () => {
    const enDash = parseCriteriaFromBody(CRITERIA_HEADING + '\n\n- [ ] **ac-1** A – verify: `cmd`');
    const hyphen = parseCriteriaFromBody(CRITERIA_HEADING + '\n\n- [ ] **ac-1** A - verify: `cmd`');
    expect(enDash.criteria[0]).toEqual({ id: 'ac-1', text: 'A', passed: false, verify: 'cmd' });
    expect(hyphen.criteria[0]).toEqual({ id: 'ac-1', text: 'A', passed: false, verify: 'cmd' });
  });

  it('accepts uppercase [X] and extra surrounding whitespace', () => {
    const r = parseCriteriaFromBody(CRITERIA_HEADING + '\n\n   - [X]   **ac-1**   A   ');
    expect(r.criteria[0]).toEqual({ id: 'ac-1', text: 'A', passed: true });
  });

  it('parses a criterion with no id (hand-added bullet)', () => {
    const r = parseCriteriaFromBody(CRITERIA_HEADING + '\n\n- [ ] just text');
    expect(r.criteria[0]).toEqual({ id: '', text: 'just text', passed: false });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/server/files/criteriaMarkdown.test.ts`
Expected: FAIL — `Cannot find module './criteriaMarkdown'`.

- [ ] **Step 3: Implement the module**

Create `src/server/files/criteriaMarkdown.ts`:

```ts
import type { AcceptanceCriterion } from '../../shared';

/**
 * The canonical on-disk format for acceptance criteria. Criteria live as a task
 * list under a `## Acceptance criteria` heading in the markdown *body* of ADR and
 * loop files. One criterion per line:
 *
 *   - [ ] **ac-1** <text> — verify: `<shell command>` 🔒
 *
 *   `[ ]`/`[x]`  -> passed (case-insensitive)
 *   **ac-N**     -> id (stable; survives reorder/edit)
 *   — verify: `…` -> verify command (optional; en-dash/hyphen tolerated)
 *   🔒           -> locked (optional)
 *   remainder    -> text
 *
 * Flat (non-nested) single-line items are used deliberately: they survive the
 * databank editor's lossy BlockNote markdown export far more reliably than nested
 * lists or HTML comments. This module is the single source of truth for the format.
 */
export const CRITERIA_HEADING = '## Acceptance criteria';

export interface ParsedCriteria {
  criteria: AcceptanceCriterion[];
  /** The body with the criteria section removed, trimmed. */
  bodyWithoutSection: string;
  /** Whether a criteria section was present at all. */
  hasSection: boolean;
}

const HEADING_RE = /^##\s+acceptance\s+criteria\s*$/i;
const ANY_HEADING_RE = /^#{1,6}\s/;
const ITEM_RE = /^\s*-\s*\[([ xX])\]\s*(.*?)\s*$/;
const ID_RE = /^\*\*([^*]+)\*\*\s*/;
const VERIFY_RE = /\s*[—–-]\s*verify:\s*`([^`]+)`\s*$/i;
const LOCKED_RE = /\s*🔒\s*$/u;

/** Extract the criteria section from a markdown body. */
export function parseCriteriaFromBody(body: string): ParsedCriteria {
  const lines = body.split('\n');
  const start = lines.findIndex((l) => HEADING_RE.test(l.trim()));
  if (start === -1) {
    return { criteria: [], bodyWithoutSection: body.trim(), hasSection: false };
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (ANY_HEADING_RE.test(lines[i])) {
      end = i;
      break;
    }
  }
  const criteria: AcceptanceCriterion[] = [];
  for (const raw of lines.slice(start + 1, end)) {
    const m = raw.match(ITEM_RE);
    if (m) criteria.push(parseItem(m[1], m[2]));
  }
  const bodyWithoutSection = [...lines.slice(0, start), ...lines.slice(end)]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { criteria, bodyWithoutSection, hasSection: true };
}

function parseItem(box: string, content: string): AcceptanceCriterion {
  let rest = content;
  let locked = false;
  if (LOCKED_RE.test(rest)) {
    locked = true;
    rest = rest.replace(LOCKED_RE, '');
  }
  let verify: string | undefined;
  const vm = rest.match(VERIFY_RE);
  if (vm) {
    verify = vm[1];
    rest = rest.replace(VERIFY_RE, '');
  }
  let id = '';
  const im = rest.match(ID_RE);
  if (im) {
    id = im[1].trim();
    rest = rest.replace(ID_RE, '');
  }
  const criterion: AcceptanceCriterion = { id, text: rest.trim(), passed: box.toLowerCase() === 'x' };
  if (verify !== undefined) criterion.verify = verify;
  if (locked) criterion.locked = true;
  return criterion;
}

/** Fill any empty/whitespace id with the next free `ac-N`. Returns a new array. */
export function assignMissingIds(criteria: AcceptanceCriterion[]): AcceptanceCriterion[] {
  let max = 0;
  for (const c of criteria) {
    const m = /^ac-(\d+)$/.exec((c.id ?? '').trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return criteria.map((c) => ((c.id ?? '').trim() ? c : { ...c, id: `ac-${++max}` }));
}

/** Replace (or append, or remove-if-empty) the criteria section in a body. */
export function upsertCriteriaInBody(body: string, criteriaIn: AcceptanceCriterion[]): string {
  const { bodyWithoutSection } = parseCriteriaFromBody(body);
  const base = bodyWithoutSection.trim();
  const criteria = assignMissingIds(criteriaIn);
  if (criteria.length === 0) return base ? `${base}\n` : '';
  const section = `${CRITERIA_HEADING}\n\n${criteria.map(renderCriterion).join('\n')}`;
  return `${base ? `${base}\n\n` : ''}${section}\n`;
}

function renderCriterion(c: AcceptanceCriterion): string {
  let line = `- [${c.passed ? 'x' : ' '}] **${c.id}** ${c.text}`.trimEnd();
  if (c.verify) line += ` — verify: \`${c.verify}\``;
  if (c.locked) line += ' 🔒';
  return line;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/server/files/criteriaMarkdown.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/server/files/criteriaMarkdown.ts src/server/files/criteriaMarkdown.test.ts
git commit -m "feat(files): markdown acceptance-criteria parser/serializer"
```

---

### Task 2: Wire ADRs into FilesService (body-authoritative)

**Files:**
- Modify: `src/server/files/filesService.ts:55-74` (`readAdr`, `writeAdr`)
- Test: `src/server/files/filesService.test.ts:73-89` (rewrite ADR round-trip)

- [ ] **Step 1: Update the ADR round-trip test to the new format**

In `src/server/files/filesService.test.ts`, replace the test `'writes an ADR then reads it back with its acceptance criteria'` (lines 73-89) with:

```ts
  it('writes an ADR (criteria in body) then reads it back', async () => {
    const files = createFilesService(root);
    const adr: AdrDoc = {
      id: 'adr-099',
      relPath: 'databank/adr-099-sample.md',
      title: 'Sample requirement',
      body: '# ADR-099\n\nContext.\n',
      acceptanceCriteria: [{ id: 'ac-1', text: 'Holds', passed: false }],
    };

    await files.writeAdr(adr);
    const readBack = await files.readAdr(adr.relPath);

    // Field round-trips; body now carries the criteria section.
    expect(readBack.acceptanceCriteria).toEqual(adr.acceptanceCriteria);
    expect(readBack.body).toContain('Context.');
    expect(readBack.body).toContain('## Acceptance criteria');
    expect(readBack.body).toContain('**ac-1** Holds');

    // Criteria are no longer in frontmatter on disk.
    const raw = await fs.readFile(path.join(root, adr.relPath), 'utf8');
    expect(raw).not.toContain('acceptanceCriteria:');

    const all = await files.listAdrs();
    expect(all.map((a) => a.id)).toEqual(['adr-099']);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/files/filesService.test.ts -t "criteria in body"`
Expected: FAIL — body lacks `## Acceptance criteria` (current `writeAdr` keeps criteria in frontmatter).

- [ ] **Step 3: Implement `readAdr` and `writeAdr`**

In `src/server/files/filesService.ts`, add this import right after the existing `import { parseFrontmatter, serializeFrontmatter } from './frontmatter';` (line 13):

```ts
import { parseCriteriaFromBody, upsertCriteriaInBody } from './criteriaMarkdown';
```

Replace `readAdr` (lines 55-65) with:

```ts
  async readAdr(relPath: string): Promise<AdrDoc> {
    const raw = await fs.readFile(this.abs(relPath), 'utf8');
    const { data, body } = parseFrontmatter<Partial<AdrDoc>>(raw);
    const parsed = parseCriteriaFromBody(body);
    // Body is authoritative. Legacy files keep criteria in frontmatter — fall back
    // to them and inject a canonical section into the returned body so the editor
    // shows them immediately (disk migrates on the next write).
    const acceptanceCriteria = parsed.hasSection
      ? parsed.criteria
      : normalizeCriteria(data.acceptanceCriteria);
    const outBody = parsed.hasSection
      ? body
      : acceptanceCriteria.length > 0
        ? upsertCriteriaInBody(body, acceptanceCriteria)
        : body;
    return {
      id: String(data.id ?? ''),
      relPath,
      title: String(data.title ?? ''),
      body: outBody,
      acceptanceCriteria,
    };
  }
```

Replace `writeAdr` (lines 67-74) with:

```ts
  async writeAdr(doc: AdrDoc): Promise<void> {
    // The body is the source of truth for ADR criteria (the editor edits the body).
    // If the body has a criteria section, use it; otherwise fall back to the field
    // (covers programmatic creation, e.g. createDatabankItem with an empty list).
    const parsed = parseCriteriaFromBody(doc.body);
    const criteria = parsed.hasSection ? parsed.criteria : doc.acceptanceCriteria;
    const body = upsertCriteriaInBody(doc.body, criteria);
    const frontmatter = { id: doc.id, title: doc.title };
    await this.writeFile(doc.relPath, serializeFrontmatter(frontmatter, body));
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/server/files/filesService.test.ts -t "criteria in body"`
Expected: PASS.

- [ ] **Step 5: Run the whole filesService suite (locked-flag fallback must still pass)**

Run: `npx vitest run src/server/files/filesService.test.ts`
Expected: PASS, including `'carries the locked flag … through normalizeCriteria'` (legacy frontmatter fallback still works) — except the loop round-trip test, which Task 3 fixes.

- [ ] **Step 6: Commit**

```bash
git add src/server/files/filesService.ts src/server/files/filesService.test.ts
git commit -m "feat(files): ADR criteria read/write through the body"
```

---

### Task 3: Wire loops into FilesService (field-authoritative)

**Files:**
- Modify: `src/server/files/filesService.ts:76-87` (`readLoop`, `writeLoop`)
- Test: `src/server/files/filesService.test.ts:40-50` (loop round-trip)

- [ ] **Step 1: Update the loop round-trip test**

In `src/server/files/filesService.test.ts`, replace the test `'writes a loop then reads back an equal LoopDoc, creating dirs as needed'` (lines 40-50) with:

```ts
  it('writes a loop (criteria in body) then reads back an equal LoopDoc', async () => {
    const files = createFilesService(root);
    const original = loop();

    await files.writeLoop(original);
    const readBack = await files.readLoop(original.relPath);

    // Frontmatter (incl. acceptanceCriteria, re-parsed from the body) round-trips.
    expect(readBack.relPath).toBe(original.relPath);
    expect(readBack.frontmatter).toEqual(original.frontmatter);
    // The prose body is preserved and the criteria section is appended.
    expect(readBack.body).toContain('Do the thing.');
    expect(readBack.body).toContain('## Acceptance criteria');
    expect(readBack.body).toContain('**ac-1** It works — verify: `npm test -- x`');

    // Criteria are no longer in frontmatter on disk.
    const raw = await fs.readFile(path.join(root, original.relPath), 'utf8');
    expect(raw).not.toContain('acceptanceCriteria:');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/files/filesService.test.ts -t "criteria in body.*LoopDoc"`
Expected: FAIL — body lacks the criteria section (current `writeLoop` serializes criteria into frontmatter).

- [ ] **Step 3: Implement `readLoop` and `writeLoop`**

In `src/server/files/filesService.ts`, replace `readLoop` (lines 76-80) with:

```ts
  async readLoop(relPath: string): Promise<LoopDoc> {
    const raw = await fs.readFile(this.abs(relPath), 'utf8');
    const { data, body } = parseFrontmatter<LoopFrontmatter>(raw);
    const parsed = parseCriteriaFromBody(body);
    // Body is the on-disk source; fall back to legacy frontmatter criteria.
    data.acceptanceCriteria = parsed.hasSection
      ? parsed.criteria
      : normalizeCriteria(data.acceptanceCriteria);
    return { frontmatter: data, body, relPath };
  }
```

Replace `writeLoop` (lines 82-87) with:

```ts
  async writeLoop(loop: LoopDoc): Promise<void> {
    // The engine mutates loop.frontmatter.acceptanceCriteria (passed/verdicts), so
    // the structured field is the source for loops. Serialize it into the body and
    // drop it from frontmatter.
    const { acceptanceCriteria, ...frontmatter } = loop.frontmatter;
    const body = upsertCriteriaInBody(loop.body, acceptanceCriteria);
    await this.writeFile(
      loop.relPath,
      serializeFrontmatter(frontmatter as unknown as Record<string, unknown>, body),
    );
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/server/files/filesService.test.ts`
Expected: PASS (entire file).

- [ ] **Step 5: Run the cascade/engine suites to catch body-equality assumptions**

Run: `npx vitest run src/server/cascade src/server/planner src/server/executor`
Expected: PASS. If a test asserts an exact loop body and now fails only because a `## Acceptance criteria` section was appended, update that assertion to check the criteria section (mirror the `toContain` style above). Do **not** change engine logic.

- [ ] **Step 6: Commit**

```bash
git add src/server/files/filesService.ts src/server/files/filesService.test.ts
git commit -m "feat(files): loop criteria read/write through the body"
```

---

### Task 4: Update the mock backend loaders

**Files:**
- Modify: `src/server/api/mock.ts` (imports + `loadAdrs:29-45`, `loadCascade:94-124`)

- [ ] **Step 1: Add the import**

In `src/server/api/mock.ts`, after the existing imports (around line 20), add:

```ts
import { parseCriteriaFromBody } from '../files/criteriaMarkdown';
```

- [ ] **Step 2: Parse criteria from the body in `loadAdrs`**

Replace the `.map((f) => { … })` body in `loadAdrs` (lines 35-43) with:

```ts
    .map((f) => {
      const { data, content } = readMd(join(dir, f));
      const parsed = parseCriteriaFromBody(content);
      return {
        id: String(data.id),
        relPath: `databank/${f}`,
        title: String(data.title ?? f),
        body: content,
        acceptanceCriteria: parsed.hasSection
          ? parsed.criteria
          : ((data.acceptanceCriteria as AcceptanceCriterion[]) ?? []),
      };
    });
```

- [ ] **Step 3: Parse criteria from the body in `loadCascade`**

Replace the loops `.map((f) => { … })` (lines 114-121) with:

```ts
    .map((f) => {
      const { data, content } = readMd(join(dir, f));
      const fm = data as unknown as LoopFrontmatter;
      const parsed = parseCriteriaFromBody(content);
      if (parsed.hasSection) fm.acceptanceCriteria = parsed.criteria;
      return {
        frontmatter: fm,
        body: content,
        relPath: `cascades/${id}/${f}`,
      };
    });
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors from `mock.ts`. (`AcceptanceCriterion` and `LoopFrontmatter` are already imported at the top of the file.)

- [ ] **Step 5: Commit**

```bash
git add src/server/api/mock.ts
git commit -m "feat(mock): parse acceptance criteria from the body"
```

---

### Task 5: Remove the read-only criteria section in the ADR editor

**Files:**
- Modify: `src/web/views/databank/AdrEditor.tsx` (doc comment, save comment, line 116 + lines 123-147)

- [ ] **Step 1: Update the component doc comment (lines 9-14)**

Replace the block comment above `export function AdrEditor()` with:

```tsx
/**
 * Opens one ADR (a plain markdown file) in the shared editor. Acceptance criteria
 * live in the markdown *body* (a `## Acceptance criteria` task list) and are edited
 * inline like the rest of the document; the server parses them back into structured
 * criteria on save. The editor passes the edited body straight through.
 */
```

- [ ] **Step 2: Simplify the save comment (line 53)**

Replace the comment line inside `save()` (currently `// Recombine: only the body changed; frontmatter + criteria are passed through.`) with:

```tsx
      // The body carries the criteria section; the server re-parses it on write.
      const next: AdrDoc = { ...adr, body };
```

- [ ] **Step 3: Remove the `<AcceptanceCriteria>` render and the component**

Delete the line `<AcceptanceCriteria adr={adr} />` (line 116) and delete the entire `AcceptanceCriteria` function (lines 123-147). After the edit, the tail of the returned JSX reads:

```tsx
          {mode === 'edit' ? (
            <MarkdownEditor value={body} onChange={setBody} />
          ) : (
            <InlineDiff before={committed} after={body} />
          )}
        </>
      )}
    </Page>
  );
}
```

and the file ends at the close of `AdrEditor` (no trailing `AcceptanceCriteria` function).

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (`cx` may now be unused if it was only used by the removed component — if typecheck/eslint flags it, remove `cx` from the `../../design/index` import on line 4. The `toggle` block still uses `cx`, so it likely stays.)

- [ ] **Step 5: Commit**

```bash
git add src/web/views/databank/AdrEditor.tsx
git commit -m "feat(databank): edit acceptance criteria inline in the body"
```

---

### Task 6: Migrate the committed fixtures

**Files:**
- Create: `scripts/migrate-criteria.ts`
- Modify (via the script): `fixtures/sample-workspace/databank/*.md`, `fixtures/sample-workspace/cascades/*/*.md`

- [ ] **Step 1: Confirm which fixtures carry frontmatter criteria**

Run: `grep -rln "acceptanceCriteria" fixtures/sample-workspace`
Expected: a list of ADR and loop `.md` files. Note them — these are what the migration will change.

- [ ] **Step 2: Write the migration script**

Create `scripts/migrate-criteria.ts`:

```ts
/**
 * One-shot migration: rewrite every ADR and loop so acceptance criteria move from
 * frontmatter into the markdown body. Read populates the structured field (with the
 * legacy frontmatter fallback); write serializes it back into the body section.
 * Idempotent — running it again is a no-op once files are migrated.
 *
 * Usage: SLOOP_WORKSPACE=fixtures/sample-workspace npx tsx scripts/migrate-criteria.ts
 */
import { FilesServiceImpl, resolveWorkspaceRoot } from '../src/server/files/filesService';

async function main() {
  const files = new FilesServiceImpl(resolveWorkspaceRoot());

  for (const adr of await files.listAdrs()) {
    await files.writeAdr(adr);
    console.log(`migrated ADR  ${adr.relPath}`);
  }

  for (const cascadeId of await files.listCascadeIds()) {
    for (const loop of await files.listLoops(cascadeId)) {
      await files.writeLoop(loop);
      console.log(`migrated loop ${loop.relPath}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Note: `resolveWorkspaceRoot` is exported (`filesService.ts:27`) and `FilesServiceImpl` is exported (`filesService.ts:38`). No source changes needed to import them.

- [ ] **Step 3: Run the migration against the fixtures**

Run: `SLOOP_WORKSPACE=fixtures/sample-workspace npx tsx scripts/migrate-criteria.ts`
Expected: one `migrated …` line per ADR and loop, no errors.

- [ ] **Step 4: Inspect the diff and confirm the format**

Run: `git diff -- fixtures/sample-workspace | head -100`
Expected: each migrated file loses its `acceptanceCriteria:` frontmatter block and gains a `## Acceptance criteria` task list in the body. Spot-check that an ADR with a `verify` and a `locked` criterion renders as
`- [ ] **ac-1** … — verify: \`…\` 🔒`.

- [ ] **Step 5: Verify the migration is idempotent**

Run: `SLOOP_WORKSPACE=fixtures/sample-workspace npx tsx scripts/migrate-criteria.ts && git diff --stat -- fixtures/sample-workspace`
Expected: the second run prints the same `migrated …` lines but produces **no new file changes** beyond step 3 (the `--stat` matches what step 3 produced).

- [ ] **Step 6: Commit**

```bash
git add scripts/migrate-criteria.ts fixtures/sample-workspace
git commit -m "chore(fixtures): migrate acceptance criteria into the body"
```

---

### Task 7: Full verification + manual BlockNote round-trip check

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the whole project**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all green. Fix any remaining failures attributable to the new body format (a criteria section now appearing in a body) by updating the assertion, not the feature.

- [ ] **Step 3: Manual BlockNote fidelity check (the key real-world risk)**

This verifies the convention survives the lossy BlockNote editor — the one thing unit tests can't prove.

1. Run: `npm run dev`
2. In the web app, open Databank and open an ADR that has acceptance criteria.
3. Confirm the `## Acceptance criteria` checklist renders in the editor body (checkboxes, `**ac-N**`, `verify: \`…\``, 🔒).
4. Edit a criterion's text, toggle a checkbox, and add a brand-new checklist item with no id.
5. Save. Then on disk run: `grep -A12 "Acceptance criteria" fixtures/sample-workspace/databank/<that-file>.md`
6. Expected: the edited text persisted, the checkbox state persisted, the new item got a fresh `**ac-N**` id, and existing `verify`/🔒 markers survived. If any marker was mangled by BlockNote export, widen the relevant regex in `criteriaMarkdown.ts` (`VERIFY_RE`/`LOCKED_RE`/`ID_RE`) and add a tolerance test capturing the exact string BlockNote emitted, then re-run Task 1's tests.

- [ ] **Step 4: Final commit (only if step 3 required a parser tweak)**

```bash
git add src/server/files/criteriaMarkdown.ts src/server/files/criteriaMarkdown.test.ts
git commit -m "fix(files): tolerate BlockNote export variations in criteria parsing"
```

---

## Notes for the implementer

- **Do not** change the `AcceptanceCriterion` type or any planner/engine logic — the whole point is that the in-memory shape is unchanged.
- The ADR vs loop asymmetry is intentional: ADR write derives criteria from the body (human-edited), loop write derives from the structured field (engine-mutated). Both produce identical on-disk format.
- The repo uses a shared single git checkout across parallel work; commit only the files each task lists, and avoid `git add -A`.
