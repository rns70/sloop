# Databank drag-to-move + rename — design

**Date:** 2026-06-13
**Status:** Approved (pending spec review)
**Scope:** The Databank section of the sidebar tree only. Roles/Templates/Cascades are out of scope (flat lists with no folder concept).

## Problem

The Databank sidebar renders a folder/file tree, but entries are immovable: the only way
to reorganize is to create a new entry and delete the old one. Users want to **drag an
entry into another folder**, **drag a whole folder into another folder**, and **rename a
file's name** — directly in the tree.

## Core model

A Databank entry's identity **is its file path** (folders are derived purely from ADR
relPaths — a folder "exists" only because a file sits under it; there is no folder entity
or folder endpoint). Three user gestures therefore all reduce to a single primitive —
*change a path*:

| Gesture | Path change |
| --- | --- |
| Move file into folder | change the directory portion (`databank/auth/x.md` → `databank/api/x.md`) |
| Rename file | change the last segment's slug (`x.md` → `y.md`) |
| Move / rename folder | change a shared path **prefix** for every descendant file |

Everything routes through one backend primitive: **`moveAdr(from, to)`**, where `from`/`to`
are databank-relative paths (a single file path, or a folder prefix).

The ADR's frontmatter `id` is **never** touched by a move/rename — only the file path/URL
changes — so any cross-references by `id` stay stable. Ordering stays alphabetical
(by relPath); there is no manual reorder and no persisted order field.

## Persistence decision: filesystem move, not `git mv`

`FilesServiceImpl` already writes ADRs straight to the working tree via `fs` and never
touches git; git only enters later at diff/commit time (`GitService.commitAll` does
`git add . && git commit`), where git auto-detects renames. A plain filesystem move
therefore **preserves history at commit** just as well as `git mv` would, and avoids two
hazards:

1. `git mv` **fails on untracked files** — a freshly-created, not-yet-committed ADR is not
   in the index.
2. The shared-checkout hazard: parallel WP agents share one git checkout, so index-mutating
   git operations during a user-initiated move risk collisions. A working-tree `fs` move
   sidesteps the index entirely.

So `moveAdr` is implemented with `fs` operations inside `FilesService`, consistent with how
`writeAdr` already bypasses git. (Decision confirmed with the user.)

## Backend (vertical slice)

### `FilesService.moveAdr(from: string, to: string): Promise<void>`

Added to `src/shared/services.ts` (interface) and implemented in
`src/server/files/filesService.ts`:

- **File move/rename:** `fs.rename(absFrom, absTo)`, `mkdir -p` the destination directory
  first, then prune any source directories left empty by the move.
- **Folder move/rename:** if the destination folder path does not already exist, a single
  atomic `fs.rename` of the whole directory; if the move would **merge** into an existing
  folder, fall back to per-descendant-file moves.
- **Guards (fail fast, before any write):**
  - `from` must exist (else `NotFound`).
  - destination must not already exist (else `Conflict` → 409).
  - a folder may not move into its own descendant (cycle → `Conflict` → 409).
  - both `from` and `to` must normalize to stay under `databank/` (path-traversal guard,
    reusing the `normalize`/`sep` pattern already in `index.ts`'s workspace-file handlers).
  - for a file target, the slug must be non-empty and `.md`-suffixed.

`from` is classified as file vs folder by whether it matches an existing ADR relPath
(file) or is a strict path-prefix of one or more ADR relPaths (folder).

### API contract & implementations

- `src/server/api/contract.ts`: add `moveAdr(from, to)` to `SloopApi`, a
  `MoveAdrRequest { to: string }` type, a `MoveAdrResponse = Ok`, and document the route in
  the header table. Add a `Conflict` error class (or reuse a shared error) for 409s.
- `src/server/api/real.ts`: `moveAdr` delegates to `files.moveAdr`, translating filesystem
  errors into `NotFound` / `Conflict`.
- `src/server/api/mock.ts`: `moveAdr` rewrites `relPath` over the in-memory `this.adrs`
  array (single file or prefix), with the same collision/cycle guards.

### Route

`POST /api/adrs/:relPath/move` in `src/server/index.ts`, body `{ to }`. `:relPath` is the
URL-encoded `from`. A new `Conflict` is funnelled to **409** in the error middleware
(alongside the existing 404/500 funnel).

## Frontend — drag and drop (`@dnd-kit`)

Use **`@dnd-kit/core`** + **`@dnd-kit/utilities`** (no `@dnd-kit/sortable` — ordering stays
alphabetical). Chosen over native HTML5 DnD for built-in keyboard accessibility, a clean
`DragOverlay` preview, and proper collision detection; the cost is one dependency, accepted.
Compatible with React 18.3.

- Wrap the tree body in `<DndContext>` (inside `DatabankTree`).
- **Draggables** (`useDraggable`): every `FileRow` and every `Folder` header. The draggable
  id encodes the path + kind (`file:databank/...` / `folder:databank/...`).
- **Droppables** (`useDroppable`): every `Folder` header and the tree root. The droppable id
  encodes the destination folder path (`''` for root).
- `<DragOverlay>` renders a floating copy of the dragged row for the drag preview.
- `onDragEnd(active, over)`:
  - resolve `from` = active path, `toFolder` = over folder path.
  - compute `to`: file → `${toFolder}/${basename(from)}`; folder → `${toFolder}/${folderName}`.
  - **no-op** when `toFolder` === current parent, when a folder is dropped on itself or a
    descendant, or `over` is null.
  - otherwise call `onMove(from, to)`; on a `Conflict`/error, surface a brief inline error
    on the row (no crash).

## Frontend — rename (double-click)

- **Double-click** a file row or a folder header → the label becomes an inline `<input>`,
  reusing the existing `FolderNameInput` interaction (autofocus, Enter commits, Esc cancels,
  blur commits). The entered text is `slugify`'d.
  - File: new path = `${dir}/${slug}.md` → `onMove(oldPath, newPath)`.
  - Folder: new path = `${parentDir}/${slug}` → `onMove(oldFolderPath, newFolderPath)`
    (prefix move of all descendants).
- Single-click still navigates (file) / toggles open (folder); the double-click handler
  suppresses the stray single-click navigation.

## Wiring & refresh

- `src/web/api-client/index.ts`: `moveAdr(from, to)` →
  `POST /adrs/:from/move` with body `{ to }`.
- `DatabankTree` gains an `onMove(from, to)` prop. `SidebarNav` owns the handler: it calls
  the client, re-fetches `getAdrs()`, and **if the currently-open ADR is the one that moved,
  navigates to its new `/databank/...` path** so the open editor does not 404.

## Testing

- `src/server/files/filesService.test.ts`: file move, folder move (atomic rename path +
  merge-fallback path), empty-source-dir pruning, collision rejection, cycle rejection,
  path-traversal rejection.
- API/route test (`real.test.ts` or sibling): happy path + 404 (missing `from`) + 409
  (collision).
- `DatabankTree` behavior test **if** a React test harness is present (drop resolves the
  correct target path; rename produces the correct path). Confirm the harness exists before
  committing to UI tests; otherwise rely on the service/route tests plus manual verification.

## Out of scope

- Reordering within a folder (ordering stays alphabetical).
- Drag/move for Roles, Templates, Cascades (no folder concept).
- Editing the displayed frontmatter title via the tree (rename targets the file slug only).
- A right-click context menu.
