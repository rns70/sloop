# Clearer git diff: sidebar indicators + readable in-document diff

**Date:** 2026-06-13
**Status:** Approved — ready for implementation plan

## Problem

Two diff surfaces are unclear today:

1. **Sidebar** (`SidebarNav` → `DatabankTree`): the Docs tree lists loops `.md` files
   with no indication of which ones have pending (uncommitted) git changes. You must open
   each doc to find out. The backend already computes this (`GitService.diffDatabank()`),
   but no lean route exposes the changed-list to the client.

2. **In-document diff** (`AdrEditor` "Showing changes" mode → `InlineDiffView`): a
   line-level LCS diff. A one-word edit renders the **whole line** struck-through red *and*
   re-added green — very noisy for prose markdown. There is also no signal of *how much*
   changed before entering the diff view.

## Goals

- Surface per-file pending-change state in the sidebar at a glance.
- Make the in-document diff read like an edited document: highlight only the words that
  actually changed.
- Make the "Showing changes" toggle advertise that changes exist (and how many) before the
  user clicks it.

## Non-goals (YAGNI)

- No side-by-side / split diff view (breaks the prose-column design intent).
- No new diff dependency (`jsdiff` etc.) — the in-house diff stays dependency-free.
- No hunk collapsing / context folding — loops docs are short.
- No change indicators on Roles/Workflows rows — scope is loops `.md` docs, where the diff
  feature lives. (`diffDatabank()` only covers `loops/`.)
- No accept/reject-per-change from the diff view (that is the editor's inline-proposal
  channel, out of scope here).

## Chosen approach

**In-document diff: word-level unified inline (Approach A).**
Keep the existing line-level LCS, then post-process consecutive remove→add line runs into
"modified" rows and run a word-level LCS within each pair. Render *inline in the document
flow* (not split columns): unchanged words neutral, removed words red-strikethrough, added
words green, with a gutter marker per row and a soft full-row tint band. Preserves the
"reads as a document" design; pure functions stay unit-testable.

**Sidebar + top-bar: lean changes endpoint + delta-colored dots.**
A new `GET /api/adrs/changes` returns `{ relPath, delta }[]` (the heavy `before`/`after`
stripped from `diffDatabank`). The sidebar fetches it on its existing nav/reload effect and
threads a `Map<relPath, Delta>` into the tree; changed file rows show a delta-colored dot,
folders roll up a faint dot when any descendant changed. The editor's top-bar toggle gains
`+N −M` counts and a disabled "No changes" state.

## Design

### 1. Diff core — `src/web/design/diff.ts` (pure, tested)

Add two pure functions alongside the existing `diffLines`/`hasChanges`:

```ts
export type Seg = { op: DiffOp; text: string };          // op: 'same' | 'add' | 'del'
export type Row =
  | { kind: 'same'; text: string }
  | { kind: 'add';  text: string }
  | { kind: 'del';  text: string }
  | { kind: 'mod';  segs: Seg[]; text: string };          // text = the *after* line (for markdown shaping)

export function wordDiff(before: string, after: string): Seg[];
export function diffRows(before: string, after: string): Row[];
export function diffStats(before: string, after: string): { added: number; removed: number };
```

- `wordDiff` tokenizes on whitespace **reversibly** (split on `/(\s+)/`, keeping the
  separators as tokens) and runs the same LCS used by `diffLines`, returning ordered
  word/space segments tagged `same`/`add`/`del`. Adjacent same-op segments may be merged
  for cleaner rendering.
- `diffRows` calls `diffLines`, then walks the result pairing each maximal run of
  consecutive `del` lines with the immediately-following run of `add` lines: zip them
  index-by-index into `mod` rows (`segs = wordDiff(delLine, addLine)`); any leftover
  `del`/`add` lines in the run become pure `del`/`add` rows. `same` lines pass through.
- `diffStats` counts changed lines (`added` = add+mod, `removed` = del+mod) for the toggle
  badge. Derived from `diffRows` so it never drifts from what is rendered.

`diffLines`/`hasChanges` are unchanged (still used elsewhere); the new functions are
additive. New tests in `src/web/design/diff.test.ts` cover: pure add, pure delete,
single-word modification (asserting only the changed word is tagged, surrounding words
`same`), multi-line replacement zipping, uneven del/add runs (leftover rows), and
`diffStats` counts.

### 2. `InlineDiffView.tsx`

Render `diffRows(before, after)` instead of `diffLines`. Per row:

- Gutter column (fixed narrow, `aria-hidden`, monospace): `+` add, `−` del, `~` mod, blank
  for same.
- Full-row soft tint band keyed to kind (add=green, del=red, mod=amber, same=none).
- `same`: existing plain rendering (blank `same` lines keep the spacer).
- `add`/`del`: whole-line tint; `del` keeps the strikethrough/dim treatment.
- `mod`: render `segs` inline — `same` neutral, `add` green, `del` red-strikethrough.
- Markdown shaping (`lineClass`/`lineText`) still applies, computed from `row.text` (the
  *after* line for `mod`/`add`, the line text for `del`/`same`).
- Keep the existing "No pending changes" empty state (drive off `diffStats` being zero).

Read-only, in-document flow — unchanged from today's contract. `InlineDiff` (databank
wrapper) and its props are untouched.

### 3. Tokens — `tailwind.config.ts`

Extend the existing `diff` palette (currently add/del only) with a **change** treatment and
a gutter/dot neutral:

```
diff: {
  addBg, addText, addAccent, delBg, delText,   // existing
  changeBg:  '#fbf3e2',   // soft amber band
  changeText:'#8a6d1f',
  changeAccent:'#caa23f', // dot + gutter `~`
}
```

(Exact hex tuned to the existing warm-neutral palette during implementation.)

### 4. Backend — changed-list endpoint

- **`src/server/api/contract.ts`**: `export interface AdrChangesResponse { changed: { relPath: string; delta: Delta }[] }`; add `getAdrChanges(): Promise<AdrChangesResponse>` to the `SloopApi` interface and document the route in the header comment block.
- **`src/server/api/real.ts`**: `async getAdrChanges()` → `const d = await this.git.diffDatabank(); return { changed: d.changed.map(({ relPath, delta }) => ({ relPath, delta })) };`. Reuses the existing git call; no new git surface.
- **`src/server/buildServer.ts`**: `app.get('/api/adrs/changes', ...)`. **Must be registered before `'/api/adrs/:relPath'`** so `changes` is not captured as a `:relPath`.
- **`src/web/api-client/index.ts`**: `export const getAdrChanges = (): Promise<AdrChangesResponse> => http('/adrs/changes');` and re-export the type.
- Backend test mirrors `real.test.ts`: in a temp target repo, modify/add/delete a loops doc
  and assert `getAdrChanges()` returns the right `{relPath, delta}` set with no
  `before`/`after` leakage.

### 5. Sidebar — `SidebarNav.tsx` + `DatabankTree.tsx`

- `SidebarNav`: add `changes` state (`Map<string, Delta> | null`); fetch `getAdrChanges()`
  inside the **existing** `useEffect` (keyed on `location.pathname`, `reloadTick`) next to
  `getAdrs()`, building the map. A failed changes fetch is non-fatal — degrade to no dots,
  do not block the tree (log/swallow, leave map empty).
- Pass `changes` into `<DatabankTree changes={changes} />`.
- `DatabankTree`:
  - `buildTree` annotates each `FileLeaf` with `delta?: Delta` (lookup by `relPath`) and
    each `FolderNode` with `hasChanges: boolean` (true if any descendant file has a delta),
    computed bottom-up during the existing build walk.
  - `FileRow`: render a small `2×2` rounded dot before/after the title when `leaf.delta` is
    set, colored by delta (`add`→`addAccent`, `change`→`changeAccent`, `delete`→`delText`),
    with a `title`/`aria-label` ("Added" / "Modified" / "Deleted"). Active/hover styles
    unchanged.
  - `Folder`: when collapsed *and* `node.hasChanges`, render a faint neutral dot on the
    header so a closed folder still signals pending edits inside.

### 6. Top-bar toggle — `AdrEditor.tsx`

- Compute `const stats = useMemo(() => diffStats(committed, body), [committed, body])`.
- The "changes" segment shows `Changes  +N −M` (counts from `stats`); when
  `stats.added + stats.removed === 0`, the segment is disabled (and if currently in
  `changes` mode with nothing to show, fall back to `edit`).
- Replace the static running-colored dot with the count badge; keep the segmented control
  styling.

## Data flow

```
GitService.diffDatabank()  ──►  real.getAdrChanges()  ──►  GET /api/adrs/changes
        │                                                          │
        │ (per-file before/after, existing)                       ▼
        └──► real.getAdrDiff(relPath) ──► AdrEditor.committed   SidebarNav.changes: Map<relPath,Delta>
                                              │                     │
                              diffRows / diffStats(committed, body) ▼
                                   │                          DatabankTree → FileRow/Folder dots
                          InlineDiffView (mod rows)   AdrEditor toggle (+N −M)
```

## Error handling

- Changes fetch failure → empty map, no dots, tree still renders (sidebar already isolates
  per-section failures; this is one more best-effort fetch).
- `getAdrDiff` already degrades to `before === after` for a brand-new/unchanged doc;
  `diffRows`/`diffStats` then yield zero changes → "No pending changes" + disabled toggle.
- Route ordering guarded by registering `/api/adrs/changes` before `/api/adrs/:relPath`.

## Testing

- **Unit (`diff.test.ts`)**: `wordDiff`, `diffRows`, `diffStats` cases listed in §1.
- **Backend (`real.test.ts` sibling)**: `getAdrChanges` add/change/delete mapping.
- **Frontend**: browser-verify under `SLOOP_DRY_RUN` — sidebar dots appear for edited docs;
  open an edited doc, toggle shows `+N −M`, "Showing changes" highlights only changed words.

## Files touched

- `src/web/design/diff.ts` (+ `diff.test.ts` new)
- `src/web/design/InlineDiffView.tsx`
- `src/web/design/index.ts` (export new diff helpers/types if needed)
- `tailwind.config.ts`
- `src/server/api/contract.ts`
- `src/server/api/real.ts` (+ test)
- `src/server/buildServer.ts`
- `src/web/api-client/index.ts`
- `src/web/shell/SidebarNav.tsx`
- `src/web/shell/DatabankTree.tsx`
- `src/web/views/databank/AdrEditor.tsx`
</content>
</invoke>
