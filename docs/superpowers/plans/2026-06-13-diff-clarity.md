# Clearer git diff — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface pending git changes per-file in the sidebar, make the in-document markdown diff highlight only the words that changed, and show change counts on the editor's diff toggle.

**Architecture:** Extend the in-house dependency-free diff (`src/web/design/diff.ts`) with word-level + row-pairing helpers, render them in `InlineDiffView`. Add a lean `GET /api/adrs/changes` endpoint (maps the existing `GitService.diffDatabank()`), and thread its result into the sidebar tree as delta-colored dots. Add `+N −M` counts to the `AdrEditor` toggle.

**Tech Stack:** TypeScript, React, React Router, Express, Tailwind, Vitest. Spec: `docs/superpowers/specs/2026-06-13-diff-clarity-design.md`.

---

## File map

- `src/web/design/diff.ts` — add `Seg`, `Row`, `wordDiff`, `diffRows`, `diffStats` (pure).
- `src/web/design/diff.test.ts` — **new** unit tests for the above.
- `src/web/design/index.ts` — export the new diff helpers/types.
- `src/web/design/InlineDiffView.tsx` — render `diffRows` with gutter + bands + word segments.
- `tailwind.config.ts` — add `diff.changeBg / changeText / changeAccent`.
- `src/server/api/contract.ts` — `AdrChangesResponse`, route comment, `SloopApi.getAdrChanges`.
- `src/server/api/real.ts` — `getAdrChanges()` implementation.
- `src/server/api/getAdrChanges.test.ts` — **new** backend test.
- `src/server/buildServer.ts` — `GET /api/adrs/changes` route (BEFORE `:relPath`).
- `src/web/api-client/index.ts` — `getAdrChanges()` + type/`Delta` re-exports.
- `src/web/shell/SidebarNav.tsx` — fetch changes, pass `Map<string, Delta>` to the tree.
- `src/web/shell/DatabankTree.tsx` — delta dots on file rows + folder rollup dots.
- `src/web/views/databank/AdrEditor.tsx` — `+N −M` counts + disabled "No changes" toggle.

---

## Task 1: Word-level + row-pairing diff helpers (pure, TDD)

**Files:**
- Modify: `src/web/design/diff.ts`
- Test: `src/web/design/diff.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `src/web/design/diff.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { wordDiff, diffRows, diffStats } from './diff';

describe('wordDiff', () => {
  it('tags only the changed word, leaving surrounding words same', () => {
    const segs = wordDiff('the quick brown fox', 'the slow brown fox');
    // reconstructing the "after" string from same+add segments is lossless
    const after = segs.filter((s) => s.op !== 'del').map((s) => s.text).join('');
    expect(after).toBe('the slow brown fox');
    expect(segs.some((s) => s.op === 'del' && s.text.includes('quick'))).toBe(true);
    expect(segs.some((s) => s.op === 'add' && s.text.includes('slow'))).toBe(true);
    // "the " and " brown fox" survive as same segments
    expect(segs.some((s) => s.op === 'same' && s.text.includes('brown'))).toBe(true);
  });

  it('merges adjacent same-op segments', () => {
    const segs = wordDiff('a b c', 'a b c');
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({ op: 'same', text: 'a b c' });
  });
});

describe('diffRows', () => {
  it('pairs a remove+add run into a mod row with word segments', () => {
    const rows = diffRows('hello world', 'hello there');
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('mod');
    if (rows[0].kind === 'mod') {
      expect(rows[0].text).toBe('hello there'); // mod.text is the after line
      expect(rows[0].segs.some((s) => s.op === 'add' && s.text.includes('there'))).toBe(true);
    }
  });

  it('emits pure add and pure del rows when only one side has a line', () => {
    const rows = diffRows('keep\n', 'keep\nadded');
    expect(rows.map((r) => r.kind)).toEqual(['same', 'same', 'add']);
  });

  it('leaves leftover rows when del and add runs are uneven', () => {
    const rows = diffRows('a\nb', 'A');
    // one pair (a->A) as mod, leftover "b" as del
    expect(rows.map((r) => r.kind)).toEqual(['mod', 'del']);
  });

  it('passes unchanged lines through as same rows', () => {
    const rows = diffRows('one\ntwo', 'one\ntwo');
    expect(rows.map((r) => r.kind)).toEqual(['same', 'same']);
  });
});

describe('diffStats', () => {
  it('counts add/del/mod lines (mod counts as both)', () => {
    expect(diffStats('a\nb\nc', 'a\nB\nc\nd')).toEqual({ added: 2, removed: 1 });
    // b->B is a mod (+1 added, +1 removed); d is a pure add (+1 added)
  });

  it('reports zero for identical input', () => {
    expect(diffStats('same', 'same')).toEqual({ added: 0, removed: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/web/design/diff.test.ts`
Expected: FAIL — `wordDiff`/`diffRows`/`diffStats` are not exported.

- [ ] **Step 3: Implement the helpers**

Append to `src/web/design/diff.ts` (keep `diffLines`/`hasChanges` unchanged):

```ts
/** One intra-line segment of a word-level diff. */
export interface Seg {
  op: DiffOp;
  text: string;
}

/**
 * A rendered diff row. `same`/`add`/`del` carry a whole line; `mod` is a paired
 * change whose `segs` are the word-level diff and whose `text` is the *after* line
 * (used for markdown shaping).
 */
export type Row =
  | { kind: 'same'; text: string }
  | { kind: 'add'; text: string }
  | { kind: 'del'; text: string }
  | { kind: 'mod'; segs: Seg[]; text: string };

/** Split a line into word + whitespace tokens (whitespace kept so a join is lossless). */
function tokenize(line: string): string[] {
  return line.split(/(\s+)/).filter((t) => t !== '');
}

/**
 * Word-level LCS diff of two lines. Returns ordered segments tagged
 * `same`/`add`/`del`; adjacent same-op segments are merged so a render walks fewer
 * spans. Concatenating non-`del` segment text reproduces `after`; non-`add` reproduces
 * `before`.
 */
export function wordDiff(before: string, after: string): Seg[] {
  const a = tokenize(before);
  const b = tokenize(after);
  const n = a.length;
  const m = b.length;

  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const raw: Seg[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push({ op: 'same', text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      raw.push({ op: 'del', text: a[i] });
      i++;
    } else {
      raw.push({ op: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) raw.push({ op: 'del', text: a[i++] });
  while (j < m) raw.push({ op: 'add', text: b[j++] });

  const merged: Seg[] = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && last.op === seg.op) last.text += seg.text;
    else merged.push({ ...seg });
  }
  return merged;
}

/**
 * Line diff post-processed into render rows: a maximal run of consecutive removed
 * lines is zipped against the immediately-following run of added lines into `mod`
 * rows (word-diffed); any leftover lines on either side become pure `del`/`add` rows.
 * Unchanged lines pass through as `same`. This turns a one-word edit from a
 * delete-whole-line + add-whole-line pair into a single word-highlighted row.
 */
export function diffRows(before: string, after: string): Row[] {
  const lines = diffLines(before, after);
  const rows: Row[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.op === 'same') {
      rows.push({ kind: 'same', text: line.text });
      i++;
      continue;
    }
    if (line.op === 'add') {
      rows.push({ kind: 'add', text: line.text });
      i++;
      continue;
    }
    // line.op === 'del': gather the del run, then the following add run, and zip them.
    const dels: string[] = [];
    while (i < lines.length && lines[i].op === 'del') dels.push(lines[i++].text);
    const adds: string[] = [];
    while (i < lines.length && lines[i].op === 'add') adds.push(lines[i++].text);
    const pairs = Math.min(dels.length, adds.length);
    for (let k = 0; k < pairs; k++) {
      rows.push({ kind: 'mod', segs: wordDiff(dels[k], adds[k]), text: adds[k] });
    }
    for (let k = pairs; k < dels.length; k++) rows.push({ kind: 'del', text: dels[k] });
    for (let k = pairs; k < adds.length; k++) rows.push({ kind: 'add', text: adds[k] });
  }
  return rows;
}

/** Changed-line counts for the editor toggle badge. A `mod` row counts as both. */
export function diffStats(before: string, after: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const row of diffRows(before, after)) {
    if (row.kind === 'add') added++;
    else if (row.kind === 'del') removed++;
    else if (row.kind === 'mod') {
      added++;
      removed++;
    }
  }
  return { added, removed };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/web/design/diff.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add src/web/design/diff.ts src/web/design/diff.test.ts
git commit -m "feat(diff): word-level + row-pairing diff helpers (wordDiff/diffRows/diffStats)"
```

---

## Task 2: Export the new diff helpers from the design barrel

**Files:**
- Modify: `src/web/design/index.ts:47-48`

- [ ] **Step 1: Update the exports**

Replace lines 47–48 of `src/web/design/index.ts`:

```ts
export { diffLines, hasChanges, wordDiff, diffRows, diffStats } from './diff';
export type { DiffLine, DiffOp, Seg, Row } from './diff';
```

- [ ] **Step 2: Verify it type-checks in isolation**

Run: `npx vitest run src/web/design/diff.test.ts`
Expected: PASS (imports still resolve; barrel unchanged for consumers).

- [ ] **Step 3: Commit**

```bash
git add src/web/design/index.ts
git commit -m "feat(diff): export wordDiff/diffRows/diffStats from design barrel"
```

---

## Task 3: Add the "change" diff color tokens

**Files:**
- Modify: `tailwind.config.ts:46-53`

- [ ] **Step 1: Add the change palette**

In `tailwind.config.ts`, replace the `diff` block (currently lines 46–53):

```ts
        // Inline-diff treatment.
        diff: {
          addBg: '#eaf6ee',
          addText: '#2f6b45',
          addAccent: '#5aa978',
          delBg: '#fdecec',
          delText: '#9a4040',
          // Modified-line ("~") treatment — soft warm amber, tuned to the palette.
          changeBg: '#fbf3e2',
          changeText: '#8a6d1f',
          changeAccent: '#caa23f',
        },
```

- [ ] **Step 2: Verify the build picks up the tokens**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i tailwind.config || echo "config ok"`
Expected: `config ok` (no type error in the config file).

- [ ] **Step 3: Commit**

```bash
git add tailwind.config.ts
git commit -m "feat(diff): add change (amber) diff color tokens"
```

---

## Task 4: Render rows in InlineDiffView

**Files:**
- Modify: `src/web/design/InlineDiffView.tsx`

- [ ] **Step 1: Replace the renderer**

Replace the entire body of `src/web/design/InlineDiffView.tsx` with:

```tsx
import { useMemo } from 'react';
import { cx } from './cx';
import { diffRows, diffStats, type DiffOp, type Row } from './diff';

export interface InlineDiffViewProps {
  before: string;
  after: string;
  className?: string;
}

/** Light per-line markdown shaping so the diff reads as a document, not a code block. */
function lineClass(text: string): string {
  const t = text.trimStart();
  if (t.startsWith('# ')) return 'text-[22px] font-bold tracking-[-0.01em]';
  if (t.startsWith('## ')) return 'text-[15px] font-semibold';
  if (t.startsWith('### ')) return 'text-[14px] font-semibold';
  if (t.startsWith('> ')) return 'border-l-2 border-line pl-3 text-ink-muted';
  return '';
}

/** Strip the leading markdown markers we visually express via lineClass. */
function lineText(text: string): string {
  return text.replace(/^\s*(#{1,3}\s|>\s)/, '');
}

const ROW_BAND: Record<Row['kind'], string> = {
  same: '',
  add: 'bg-diff-addBg',
  del: 'bg-diff-delBg',
  mod: 'bg-diff-changeBg',
};

const GUTTER: Record<Row['kind'], string> = { same: ' ', add: '+', del: '−', mod: '~' };

const GUTTER_CLASS: Record<Row['kind'], string> = {
  same: 'text-transparent',
  add: 'text-diff-addAccent',
  del: 'text-diff-delText',
  mod: 'text-diff-changeAccent',
};

/** Word-segment tint inside a `mod` row. */
const SEG_CLASS: Record<DiffOp, string> = {
  same: '',
  add: 'rounded-sm bg-diff-addBg text-diff-addText',
  del: 'rounded-sm bg-diff-delBg text-diff-delText line-through opacity-80',
};

/**
 * Renders a before/after markdown diff *inline within the document flow*. Each line is a
 * row with a gutter marker (+ / − / ~) and a soft tint band; a `mod` row highlights only
 * the words that changed (added green, removed red-strikethrough) rather than nuking the
 * whole line. Read-only. This is the in-document diff treatment (not a side rail), per the
 * locked design.
 */
export function InlineDiffView({ before, after, className }: InlineDiffViewProps) {
  const rows = useMemo(() => diffRows(before, after), [before, after]);
  const stats = useMemo(() => diffStats(before, after), [before, after]);
  const changed = stats.added > 0 || stats.removed > 0;

  return (
    <div className={cx('text-[14.5px] leading-[1.75] text-ink', className)}>
      {!changed && (
        <p className="mb-4 text-[12.5px] text-ink-faint">
          No pending changes — this matches the last accepted version.
        </p>
      )}
      {rows.map((row, idx) => {
        const blank = row.text.trim() === '';
        if (blank && row.kind === 'same') return <div key={idx} className="h-3" />;
        return (
          <div key={idx} className={cx('-mx-2 my-0.5 flex gap-2 rounded px-2', ROW_BAND[row.kind])}>
            <span
              aria-hidden
              className={cx('select-none font-mono text-[12px] leading-[1.75]', GUTTER_CLASS[row.kind])}
            >
              {GUTTER[row.kind]}
            </span>
            <span className={cx('min-w-0 flex-1', row.kind !== 'mod' && lineClass(row.text))}>
              {row.kind === 'mod'
                ? row.segs.map((seg, s) => (
                    <span key={s} className={cx(SEG_CLASS[seg.op])}>
                      {seg.text}
                    </span>
                  ))
                : lineText(row.text) || ' '}
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

Note: `mod` rows intentionally skip `lineClass` shaping — their `segs` still contain any leading markdown marker (e.g. `## `) as a `same` segment, so the marker renders verbatim rather than being doubly styled. Pure `add`/`del`/`same` rows keep the existing marker-stripping behavior.

- [ ] **Step 2: Verify the design package still type-checks / tests pass**

Run: `npx vitest run src/web/design/`
Expected: PASS (tokens test + diff test green; no InlineDiffView snapshot exists).

- [ ] **Step 3: Commit**

```bash
git add src/web/design/InlineDiffView.tsx
git commit -m "feat(diff): render word-level rows with gutter markers and tint bands"
```

---

## Task 5: Backend — `getAdrChanges` contract + implementation

**Files:**
- Modify: `src/server/api/contract.ts`
- Modify: `src/server/api/real.ts:209-216` (insert after `getAdrDiff`)
- Test: `src/server/api/getAdrChanges.test.ts` (create)

- [ ] **Step 1: Write the failing backend test**

Create `src/server/api/getAdrChanges.test.ts`:

```ts
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { createRealApi } from './real';

let root: string;

/** Run git in `root` with a deterministic identity (a repo is required for diffs). */
function git(args: string[]): void {
  execFileSync('git', args, {
    cwd: root,
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'sloop',
      GIT_AUTHOR_EMAIL: 'sloop@earendil.works',
      GIT_COMMITTER_NAME: 'sloop',
      GIT_COMMITTER_EMAIL: 'sloop@earendil.works',
    },
  });
}

async function write(rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
}

const ADR_A = 'loops/adr-a.md';
const ADR_B = 'loops/adr-b.md';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sloop-changes-'));
  await write(ADR_A, '---\nid: adr-a\ntitle: A\nstatus: idle\n---\n# A\n\noriginal A\n');
  await write(ADR_B, '---\nid: adr-b\ntitle: B\nstatus: idle\n---\n# B\n\noriginal B\n');
  git(['init', '-q']);
  git(['add', '.']);
  git(['commit', '-q', '-m', 'seed']);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('RealApi.getAdrChanges', () => {
  it('reports add/change/delete deltas and strips before/after', async () => {
    await write(ADR_A, '---\nid: adr-a\ntitle: A\nstatus: idle\n---\n# A\n\nchanged A\n');
    await fs.rm(path.join(root, ADR_B));
    await write('loops/adr-c.md', '---\nid: adr-c\ntitle: C\nstatus: idle\n---\n# C\n\nbrand new\n');

    const api = await createRealApi(root, process.env);
    const { changed } = await api.getAdrChanges();
    const byPath = Object.fromEntries(changed.map((c) => [c.relPath, c]));

    expect(byPath[ADR_A].delta).toBe('change');
    expect(byPath[ADR_B].delta).toBe('delete');
    expect(byPath['loops/adr-c.md'].delta).toBe('add');
    // Lean payload: only relPath + delta, no file contents.
    expect(Object.keys(byPath[ADR_A]).sort()).toEqual(['delta', 'relPath']);
  });

  it('returns an empty list immediately after a commit', async () => {
    const api = await createRealApi(root, process.env);
    const { changed } = await api.getAdrChanges();
    expect(changed).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/api/getAdrChanges.test.ts`
Expected: FAIL — `api.getAdrChanges` is not a function / not in the type.

- [ ] **Step 3: Add the contract type, route comment, and interface method**

In `src/server/api/contract.ts`:

(a) Add `Delta` to the shared type import (line 26–30 block):

```ts
import type {
  AdrDoc, WorkflowDef, RoleDef,
  AssistantChatRequest, AssistantStreamEvent, ModelOption,
  RunHistoryEntry, Delta,
} from '../../shared/index';
```

(b) Add a route line to the header comment after the `/diff` line (line 12):

```
//   GET  /api/adrs/changes         -> AdrChangesResponse            lean pending-change list
```

(c) Add the response type after `AdrDiffResponse` (after line 57):

```ts
/** GET /api/adrs/changes — the lean pending-change list for the sidebar: one entry per
 *  changed loops doc, `before`/`after` stripped (use /diff for a single doc's content). */
export interface AdrChangesResponse {
  changed: { relPath: string; delta: Delta }[];
}
```

(d) Add the method to the `SloopApi` interface, right after `getAdrDiff` (line 96):

```ts
  getAdrChanges(): Promise<AdrChangesResponse>;
```

- [ ] **Step 4: Implement `getAdrChanges` in real.ts**

In `src/server/api/real.ts`, insert immediately after the `getAdrDiff` method (after line 216):

```ts
  async getAdrChanges(): Promise<AdrChangesResponse> {
    const diff = await this.git.diffDatabank();
    // Strip the heavy before/after — the sidebar only needs which docs changed and how.
    return { changed: diff.changed.map(({ relPath, delta }) => ({ relPath, delta })) };
  }
```

Then add `AdrChangesResponse` to the existing contract-type import in `real.ts` (find the line importing `AdrDiffResponse` from `./contract` and add `AdrChangesResponse` to it).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/server/api/getAdrChanges.test.ts`
Expected: PASS (both cases green).

- [ ] **Step 6: Commit**

```bash
git add src/server/api/contract.ts src/server/api/real.ts src/server/api/getAdrChanges.test.ts
git commit -m "feat(api): GET /api/adrs/changes — lean pending-change list"
```

---

## Task 6: Wire the route and the API client

**Files:**
- Modify: `src/server/buildServer.ts:47` (insert BEFORE the `:relPath` routes)
- Modify: `src/web/api-client/index.ts`

- [ ] **Step 1: Register the route before `:relPath`**

In `src/server/buildServer.ts`, insert a new line immediately after line 47 (`app.get('/api/adrs', ...)`) and BEFORE `'/api/adrs/:relPath/diff'`:

```ts
  app.get('/api/adrs/changes', h(async (_req, res) => res.json(await api.getAdrChanges())));
```

(Ordering matters: `:relPath` is a single non-slash segment, so `changes` would otherwise be captured as a relPath.)

- [ ] **Step 2: Add the client call + type/Delta re-exports**

In `src/web/api-client/index.ts`:

(a) Add `Delta` to the shared re-export block (the `export type { ... } from '../../shared/index';` list):

```ts
export type {
  AdrDoc, WorkflowDef, RoleDef, AcceptanceCriterion, AdrStatus, Delta,
  AssistantChatRequest, AssistantStreamEvent, ModelOption,
  AdrRunEvent, RunHistoryEntry,
} from '../../shared/index';
```

(b) Add `AdrChangesResponse` to the contract type import (the `import type { AdrDiffResponse, ... } from '../../server/api/contract';` block) and re-export it next to `AdrDiffResponse`:

```ts
export type { AdrDiffResponse, AdrChangesResponse } from '../../server/api/contract';
```

(c) Add the fetch helper next to `getAdrDiff` (around line 79):

```ts
export const getAdrChanges = (): Promise<AdrChangesResponse> => http('/adrs/changes');
```

- [ ] **Step 3: Verify the server test still passes via the HTTP surface**

Run: `npx vitest run src/server/api/getAdrChanges.test.ts`
Expected: PASS (unchanged — confirms no regression from wiring).

- [ ] **Step 4: Commit**

```bash
git add src/server/buildServer.ts src/web/api-client/index.ts
git commit -m "feat(api): wire /api/adrs/changes route + getAdrChanges client"
```

---

## Task 7: Sidebar — fetch changes and pass the map to the tree

**Files:**
- Modify: `src/web/shell/SidebarNav.tsx`

- [ ] **Step 1: Import the client + Delta type**

In `src/web/shell/SidebarNav.tsx`, add `getAdrChanges` and `type Delta` to the existing `../api-client/index` import (the block at lines 13–24):

```ts
import {
  deleteAdr,
  deleteFile,
  getAdrs,
  getAdrChanges,
  getRoles,
  getWorkflows,
  moveAdr,
  ApiError,
  type AdrDoc,
  type Delta,
  type RoleDef,
  type WorkflowDef,
} from '../api-client/index';
```

- [ ] **Step 2: Add changes state and fetch it in the existing effect**

After the `adrs` state declaration (line 208), add:

```ts
  const [changes, setChanges] = useState<Map<string, Delta>>(new Map());
```

Inside the navigation `useEffect` (the one keyed on `[location.pathname, reloadTick]`, lines 230–239), add a changes fetch alongside the `getAdrs()` call. A failed fetch is non-fatal — degrade to no dots:

```ts
  useEffect(() => {
    let cancelled = false;
    setMoveErr(null); // a navigation means the stale move notice no longer applies
    getAdrs().then((v) => !cancelled && setAdrs(v)).catch(fail('adrs'));
    getRoles().then((v) => !cancelled && setRoles(v)).catch(fail('roles'));
    getWorkflows().then((v) => !cancelled && setWorkflows(v)).catch(fail('workflows'));
    // Pending-change dots are best-effort: on failure, show the tree with no dots.
    getAdrChanges()
      .then((res) => {
        if (cancelled) return;
        setChanges(new Map(res.changed.map((c) => [c.relPath, c.delta])));
      })
      .catch(() => !cancelled && setChanges(new Map()));
    return () => {
      cancelled = true;
    };
  }, [location.pathname, reloadTick]);
```

- [ ] **Step 3: Pass `changes` into DatabankTree**

In the JSX (the `<DatabankTree ... />` at lines 407–416), add the prop:

```tsx
              <DatabankTree
                adrs={adrs}
                changes={changes}
                onNewItem={newAdr}
                onNewFolder={newFolder}
                onMove={moveDatabank}
                onDuplicate={duplicateDatabank}
                onDelete={deleteDatabank}
                rootAdding={rootAddingFolder}
                onRootAddingDone={() => setRootAddingFolder(false)}
              />
```

- [ ] **Step 4: Verify it type-checks (DatabankTree prop added in Task 8)**

This task leaves a temporary type error until Task 8 adds the `changes` prop. Proceed to Task 8 before type-checking; commit the two together if the executor prefers a green checkpoint. To keep commits atomic, commit now and fix the type in the very next task:

```bash
git add src/web/shell/SidebarNav.tsx
git commit -m "feat(sidebar): fetch pending-change map and pass it to the databank tree"
```

---

## Task 8: DatabankTree — delta dots on files and folder rollups

**Files:**
- Modify: `src/web/shell/DatabankTree.tsx`

- [ ] **Step 1: Add `Delta` import and the `changes` prop**

In `src/web/shell/DatabankTree.tsx`, add `type Delta` to the `../api-client/index` import (line 25):

```ts
import type { AdrDoc, Delta } from '../api-client/index';
```

Extend `FileLeaf` and `FolderNode` (lines 36–46) with diff state:

```ts
interface FileLeaf {
  title: string;
  to: string;
  relPath: string; // loops-prefixed, e.g. loops/auth/a.md — the drag source + move identity
  delta?: Delta;   // set when this doc has a pending git change
}
interface FolderNode {
  name: string;
  path: string; // loops-relative, e.g. "auth" or "auth/oauth"
  folders: FolderNode[];
  files: FileLeaf[];
  hasChanges: boolean; // any descendant file has a pending change (for the collapsed-folder dot)
}
```

- [ ] **Step 2: Thread `changes` through `buildTree` and roll up folder state**

Replace `buildTree` (lines 53–79) with a version that stamps deltas and computes rollups:

```ts
/** Build the folder/file tree from ADR relPaths, stamping each file's pending delta
 *  (from `changes`) and rolling that up to `hasChanges` on every ancestor folder. */
function buildTree(adrs: AdrDoc[], changes: Map<string, Delta>): FolderNode {
  const root: FolderNode = { name: '', path: '', folders: [], files: [], hasChanges: false };
  for (const adr of [...adrs].sort((a, b) => a.relPath.localeCompare(b.relPath))) {
    const sub = adr.relPath.replace(/^loops\//, '');
    const segments = sub.split('/');
    const fileName = segments.pop() ?? sub;
    const delta = changes.get(adr.relPath);
    let node = root;
    if (delta) node.hasChanges = true;
    let acc = '';
    for (const seg of segments) {
      acc = acc ? `${acc}/${seg}` : seg;
      let next = node.folders.find((f) => f.name === seg);
      if (!next) {
        next = { name: seg, path: acc, folders: [], files: [], hasChanges: false };
        node.folders.push(next);
      }
      node = next;
      if (delta) node.hasChanges = true;
    }
    const dirPrefix = segments.length ? `${segments.map(enc).join('/')}/` : '';
    node.files.push({
      title: adr.title || fileName,
      to: `/loops/${dirPrefix}${enc(fileName)}`,
      relPath: adr.relPath,
      delta,
    });
  }
  return root;
}
```

- [ ] **Step 3: Accept the prop and pass it to `buildTree`**

In `DatabankTreeProps` (after `adrs: AdrDoc[];`, line 82) add:

```ts
  /** Pending git change per loops doc (relPath -> delta), driving the sidebar dots. */
  changes: Map<string, Delta>;
```

In the `DatabankTree` function signature destructure `changes` and use it (lines 107–117):

```ts
export function DatabankTree({
  adrs,
  changes,
  onNewItem,
  onNewFolder,
  onMove,
  onDuplicate,
  onDelete,
  rootAdding,
  onRootAddingDone,
}: DatabankTreeProps) {
  const root = buildTree(adrs, changes);
```

- [ ] **Step 4: Add a `DeltaDot` component**

Add near the top of the file (after the `enc` const, line 48):

```tsx
const DELTA_DOT: Record<Delta, { cls: string; label: string }> = {
  add: { cls: 'bg-diff-addAccent', label: 'Added' },
  change: { cls: 'bg-diff-changeAccent', label: 'Modified' },
  delete: { cls: 'bg-diff-delText', label: 'Deleted' },
};

/** A small colored dot marking a pending git change on a row. */
function DeltaDot({ delta, faint }: { delta: Delta; faint?: boolean }) {
  const { cls, label } = DELTA_DOT[delta];
  return (
    <span
      className={cx('h-1.5 w-1.5 shrink-0 rounded-full', cls, faint && 'opacity-50')}
      title={label}
      aria-label={label}
    />
  );
}
```

- [ ] **Step 5: Render the file-row dot**

In `FileRow`, render a dot when `leaf.delta` is set. Replace the `<NavLink>` (lines 371–383) with a flex wrapper that keeps the dot aligned right:

```tsx
      <NavLink
        to={leaf.to}
        title={leaf.title}
        style={indent(depth + 1)}
        className={({ isActive }) =>
          cx(
            'flex items-center gap-1.5 rounded-md py-1 pr-2 text-[13px] transition-colors',
            isActive ? 'bg-active font-medium text-ink' : 'text-ink-muted hover:bg-line-soft',
          )
        }
      >
        <span className="min-w-0 flex-1 truncate">{leaf.title}</span>
        {leaf.delta && <DeltaDot delta={leaf.delta} />}
      </NavLink>
```

- [ ] **Step 6: Render the collapsed-folder rollup dot**

In `Folder`, show a faint change dot on the header when the folder is collapsed and has descendant changes. In the header row, after the folder name `<span>` (line 278) and before the closing `</button>`, add:

```tsx
          {!open && node.hasChanges && <DeltaDot delta="change" faint />}
```

- [ ] **Step 7: Type-check the whole project**

Run: `npx vitest run src/web/design/diff.test.ts src/server/api/getAdrChanges.test.ts`
Expected: PASS. Also run the editor's type surface check:
Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "SidebarNav|DatabankTree" || echo "sidebar types ok"`
Expected: `sidebar types ok` (no errors in the two files; pre-existing unrelated `shared/index` export errors noted in the spec caveat may still appear elsewhere and are out of scope).

- [ ] **Step 8: Commit**

```bash
git add src/web/shell/DatabankTree.tsx
git commit -m "feat(sidebar): delta-colored change dots on files + folder rollup"
```

---

## Task 9: AdrEditor — change counts on the diff toggle

**Files:**
- Modify: `src/web/views/databank/AdrEditor.tsx`

- [ ] **Step 1: Import diffStats and add useMemo**

In `src/web/views/databank/AdrEditor.tsx`, add `diffStats` to the design import (line 5):

```ts
import { Button, CriteriaWarning, EditableTitle, MarkdownEditor, Page, cx, diffStats, type MarkdownEditorHandle } from '../../design/index';
```

`useMemo` is already imported? Check the React import (line 1: `useCallback, useEffect, useRef, useState`). Add `useMemo`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
```

- [ ] **Step 2: Compute stats and fall back out of an empty diff**

After the `dirty`/`missingCriteria` lines (line 92–93), add:

```ts
  const stats = useMemo(() => diffStats(committed, body), [committed, body]);
  const hasChanges = stats.added > 0 || stats.removed > 0;

  // If the user is in "changes" mode and nothing differs anymore, drop back to edit.
  useEffect(() => {
    if (mode === 'changes' && !hasChanges) setMode('edit');
  }, [mode, hasChanges]);
```

- [ ] **Step 3: Replace the toggle with count-aware segments**

Replace the `toggle` block (lines 118–137) with:

```tsx
  const toggle = (
    <div className="flex items-center gap-1 rounded-md bg-line-soft p-0.5">
      <button
        type="button"
        onClick={() => setMode('edit')}
        className={cx(
          'flex min-h-6 items-center rounded px-2 text-[12px] transition-colors',
          mode === 'edit' ? 'bg-paper font-medium text-ink shadow-sm' : 'text-ink-muted',
        )}
      >
        Edit
      </button>
      <button
        type="button"
        onClick={() => hasChanges && setMode('changes')}
        disabled={!hasChanges}
        title={hasChanges ? 'Show pending changes' : 'No pending changes'}
        className={cx(
          'flex min-h-6 items-center gap-1.5 rounded px-2 text-[12px] transition-colors',
          mode === 'changes' ? 'bg-paper font-medium text-ink shadow-sm' : 'text-ink-muted',
          !hasChanges && 'cursor-default opacity-50',
        )}
      >
        <span>Changes</span>
        {hasChanges ? (
          <span className="flex items-center gap-1 font-mono text-[11px] tabular-nums">
            <span className="text-diff-addText">+{stats.added}</span>
            <span className="text-diff-delText">−{stats.removed}</span>
          </span>
        ) : (
          <span className="text-[11px] text-ink-faint">0</span>
        )}
      </button>
    </div>
  );
```

- [ ] **Step 4: Type-check the editor**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "AdrEditor" || echo "editor types ok"`
Expected: `editor types ok`.

- [ ] **Step 5: Commit**

```bash
git add src/web/views/databank/AdrEditor.tsx
git commit -m "feat(editor): show +N −M change counts on the diff toggle"
```

---

## Task 10: Full test suite + browser verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit/integration suite**

Run: `npx vitest run`
Expected: PASS for the new diff/changes tests and no regressions in existing suites. (Pre-existing `shared/index` export breakage noted in the spec caveat is out of scope — confirm no NEW failures in files this plan touched.)

- [ ] **Step 2: Browser-verify under dry run**

Start the app with `SLOOP_DRY_RUN=1` (per the project's run skill), then:
1. Edit a loops `.md` doc and save → its sidebar row shows a colored dot; a collapsed parent folder shows a faint dot.
2. Open the edited doc → the "Changes" toggle shows `+N −M`; an unchanged doc shows the toggle disabled with `0`.
3. Click "Changes" → a one-word edit highlights only the changed word (green add / red strikethrough), not the whole line; gutter shows `~` for modified, `+`/`−` for pure add/remove.

- [ ] **Step 3: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "test(diff): verify sidebar dots + word-level diff end to end"
```

---

## Self-review notes

- **Spec coverage:** sidebar dots (Tasks 5–8), word-level in-document diff (Tasks 1–4), top-bar counts (Task 9), lean endpoint + route ordering (Tasks 5–6), tokens (Task 3) — all spec sections mapped.
- **Type consistency:** `Row`/`Seg`/`Delta`/`AdrChangesResponse`/`diffStats`/`diffRows`/`wordDiff`/`getAdrChanges` names are used identically across tasks. `changes` is `Map<string, Delta>` everywhere.
- **Known caveat (from spec):** the working tree may not fully `tsc` due to an unrelated in-progress `shared/index` export refactor. Tests run via vitest/esbuild (no full typecheck), so they still pass; type-check assertions in this plan are scoped with `grep` to the touched files.
</content>
