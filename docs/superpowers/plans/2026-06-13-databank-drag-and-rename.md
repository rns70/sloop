# Databank Drag-to-Move + Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users drag Databank entries (files and whole folders) into other folders and rename a file's slug, directly in the sidebar tree.

**Architecture:** Every gesture (move file, move folder, rename file/folder) reduces to one backend primitive — `moveAdr(from, to)` — that changes a file's path (or a folder prefix) on the working tree via `fs`, never `git`. The frontend computes the target path with pure, unit-tested helpers and calls a new `POST /api/adrs/:relPath/move` route through the typed api-client. Drag interactions use `@dnd-kit`; rename uses an inline input on double-click.

**Tech Stack:** TypeScript, Node `fs`, Express, React 18, `@dnd-kit/core` + `@dnd-kit/utilities`, Vitest (node environment — no DOM, so UI logic is tested via extracted pure helpers).

**Reference spec:** `docs/superpowers/specs/2026-06-13-databank-drag-and-rename-design.md`

**Path conventions (used throughout):**
- ADR `relPath` is databank-prefixed: `databank/auth/adr-007.md`.
- A folder path is also databank-prefixed: `databank/auth`. The tree root folder is `databank`.
- `moveAdr(from, to)` takes full databank-prefixed paths. `from` is either an exact ADR relPath (file move/rename) or a folder prefix that is a strict ancestor of one or more ADR relPaths (folder move/rename).

---

## Task 1: `FilesService.moveAdr` — interface + filesystem implementation

**Files:**
- Modify: `src/shared/services.ts` (add to `FilesService` interface)
- Modify: `src/server/files/filesService.ts` (implement + `MoveError`)
- Test: `src/server/files/filesService.test.ts` (append tests)

- [ ] **Step 1: Write the failing tests**

Append to `src/server/files/filesService.test.ts` (inside the top-level `describe('FilesService', ...)` block, after the existing tests). Add `import { MoveError } from './filesService';` to the existing import of `createFilesService` at the top of the file:

```typescript
describe('moveAdr', () => {
  const writeAdrFile = async (rel: string, title: string) => {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, `---\nid: ${path.basename(rel, '.md')}\ntitle: ${title}\n---\n\nBody.\n`, 'utf8');
  };

  it('moves a file into another folder and prunes the emptied source dir', async () => {
    const files = createFilesService(root);
    await writeAdrFile('databank/auth/a.md', 'A');
    await files.moveAdr('databank/auth/a.md', 'databank/api/a.md');
    expect(await fs.readFile(path.join(root, 'databank/api/a.md'), 'utf8')).toContain('title: A');
    await expect(fs.access(path.join(root, 'databank/auth'))).rejects.toThrow(); // pruned
  });

  it('renames a file in place (same dir, new slug)', async () => {
    const files = createFilesService(root);
    await writeAdrFile('databank/auth/a.md', 'A');
    await files.moveAdr('databank/auth/a.md', 'databank/auth/b.md');
    expect(await fs.access(path.join(root, 'databank/auth/b.md')).then(() => true)).toBe(true);
    await expect(fs.access(path.join(root, 'databank/auth/a.md'))).rejects.toThrow();
  });

  it('moves a whole folder (atomic rename) carrying all descendants', async () => {
    const files = createFilesService(root);
    await writeAdrFile('databank/auth/a.md', 'A');
    await writeAdrFile('databank/auth/oauth/b.md', 'B');
    await files.moveAdr('databank/auth', 'databank/api/auth');
    expect(await fs.access(path.join(root, 'databank/api/auth/a.md')).then(() => true)).toBe(true);
    expect(await fs.access(path.join(root, 'databank/api/auth/oauth/b.md')).then(() => true)).toBe(true);
  });

  it('merges a folder into an existing destination folder (per-file fallback)', async () => {
    const files = createFilesService(root);
    await writeAdrFile('databank/auth/a.md', 'A');
    await writeAdrFile('databank/api/keep.md', 'Keep');
    await files.moveAdr('databank/auth', 'databank/api/auth');
    expect(await fs.access(path.join(root, 'databank/api/keep.md')).then(() => true)).toBe(true);
    expect(await fs.access(path.join(root, 'databank/api/auth/a.md')).then(() => true)).toBe(true);
  });

  it('rejects a destination collision with a Conflict MoveError', async () => {
    const files = createFilesService(root);
    await writeAdrFile('databank/auth/a.md', 'A');
    await writeAdrFile('databank/api/a.md', 'Other');
    await expect(files.moveAdr('databank/auth/a.md', 'databank/api/a.md')).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('rejects moving a folder into its own descendant', async () => {
    const files = createFilesService(root);
    await writeAdrFile('databank/auth/a.md', 'A');
    await expect(files.moveAdr('databank/auth', 'databank/auth/sub')).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('rejects a path that escapes databank/', async () => {
    const files = createFilesService(root);
    await writeAdrFile('databank/auth/a.md', 'A');
    await expect(files.moveAdr('databank/auth/a.md', 'databank/../evil.md')).rejects.toMatchObject({
      code: 'invalid',
    });
  });

  it('throws not_found when the source does not exist', async () => {
    const files = createFilesService(root);
    await expect(files.moveAdr('databank/nope.md', 'databank/x.md')).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/server/files/filesService.test.ts -t moveAdr`
Expected: FAIL — `MoveError` is not exported and `moveAdr` is not a function.

- [ ] **Step 3: Add `moveAdr` to the `FilesService` interface**

In `src/shared/services.ts`, add to the `FilesService` interface (after `writeAdr`):

```typescript
  /** Move/rename an ADR file, or a whole folder prefix, on the working tree.
   *  `from`/`to` are databank-prefixed paths. Throws MoveError on collision,
   *  cycle, traversal, or a missing source. */
  moveAdr(from: string, to: string): Promise<void>;
```

- [ ] **Step 4: Implement `MoveError` and `moveAdr` in `filesService.ts`**

In `src/server/files/filesService.ts`, add near the top (after the existing `const DATABANK_DIR = 'databank';` and the other dir constants):

```typescript
const DATABANK_PREFIX = `${DATABANK_DIR}/`;

/** Failure modes of `moveAdr`, discriminated by `code` so the API layer can map
 *  them to HTTP statuses without importing fs-specific error types. */
export class MoveError extends Error {
  constructor(
    readonly code: 'not_found' | 'conflict' | 'invalid',
    message: string,
  ) {
    super(message);
    this.name = 'MoveError';
  }
}
```

Add these methods inside `class FilesServiceImpl` (after `writeAdr`):

```typescript
  async moveAdr(from: string, to: string): Promise<void> {
    this.assertInDatabank(from);
    this.assertInDatabank(to);
    if (from === to) return;

    const adrs = await this.listAdrs();
    const relPaths = adrs.map((a) => a.relPath);
    const isFile = relPaths.includes(from);
    const isFolder = relPaths.some((p) => p.startsWith(`${from}/`));
    if (!isFile && !isFolder) {
      throw new MoveError('not_found', `Nothing to move at: ${from}`);
    }

    if (isFolder) {
      // Cycle guard: cannot move a folder into itself or a descendant of itself.
      if (to === from || to.startsWith(`${from}/`)) {
        throw new MoveError('conflict', `Cannot move ${from} into its own subtree`);
      }
      await this.moveFolder(from, to, relPaths);
      return;
    }

    // Single file.
    if (await pathExists(this.abs(to))) {
      throw new MoveError('conflict', `Destination already exists: ${to}`);
    }
    await this.renamePath(from, to);
  }

  /** Move a folder prefix. Atomic dir rename when the destination is free; otherwise
   *  a per-descendant-file move (merge into an existing destination folder). */
  private async moveFolder(from: string, to: string, relPaths: string[]): Promise<void> {
    if (!(await pathExists(this.abs(to)))) {
      await this.renamePath(from, to);
      return;
    }
    // Merge: move each descendant file individually, failing fast on any collision.
    const descendants = relPaths.filter((p) => p.startsWith(`${from}/`));
    const targets = descendants.map((p) => `${to}/${p.slice(from.length + 1)}`);
    for (const target of targets) {
      if (await pathExists(this.abs(target))) {
        throw new MoveError('conflict', `Destination already exists: ${target}`);
      }
    }
    for (let i = 0; i < descendants.length; i += 1) {
      await this.renamePath(descendants[i], targets[i]);
    }
  }

  /** fs.rename with parent-dir creation and empty-source-dir pruning, all under root. */
  private async renamePath(fromRel: string, toRel: string): Promise<void> {
    const fromAbs = this.abs(fromRel);
    const toAbs = this.abs(toRel);
    await fs.mkdir(path.dirname(toAbs), { recursive: true });
    await fs.rename(fromAbs, toAbs);
    await this.pruneEmptyDirs(path.dirname(fromRel));
  }

  /** Remove now-empty directories from `relDir` up to (but not including) databank/. */
  private async pruneEmptyDirs(relDir: string): Promise<void> {
    let dir = relDir;
    while (dir.startsWith(DATABANK_PREFIX)) {
      try {
        await fs.rmdir(this.abs(dir)); // only succeeds when empty
      } catch {
        return; // non-empty or already gone — stop climbing
      }
      dir = path.dirname(dir);
    }
  }

  /** Reject paths that normalize outside databank/ (traversal defense). */
  private assertInDatabank(relPath: string): void {
    const norm = path.normalize(relPath);
    if (norm !== DATABANK_DIR && !norm.startsWith(DATABANK_PREFIX)) {
      throw new MoveError('invalid', `Path is outside databank/: ${relPath}`);
    }
  }
```

Add this module-level helper at the bottom of the file (next to `listMarkdown`):

```typescript
/** True if `abs` exists on disk. */
async function pathExists(abs: string): Promise<boolean> {
  try {
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/server/files/filesService.test.ts -t moveAdr`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/shared/services.ts src/server/files/filesService.ts src/server/files/filesService.test.ts
git commit -m "feat(files): moveAdr primitive for file/folder move and rename"
```

---

## Task 2: API contract, real/mock implementations, route, and 409 funnel

**Files:**
- Modify: `src/server/api/contract.ts` (types + `SloopApi.moveAdr`)
- Modify: `src/server/api/real.ts` (`Conflict` + `moveAdr`)
- Modify: `src/server/api/mock.ts` (`Conflict` + `moveAdr`)
- Modify: `src/server/index.ts` (route + 409 funnel)
- Test: `src/server/api/move.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `src/server/api/move.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRealApi, Conflict, NotFound } from './real';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sloop-move-'));
  await fs.mkdir(path.join(root, 'databank/auth'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'databank/auth/a.md'),
    '---\nid: a\ntitle: A\n---\n\nBody.\n',
    'utf8',
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('RealApi.moveAdr', () => {
  it('moves a file and exposes it at its new relPath', async () => {
    const api = await createRealApi(root, { SLOOP_DRY_RUN: '1' } as NodeJS.ProcessEnv);
    await api.moveAdr('databank/auth/a.md', 'databank/api/a.md');
    const adrs = await api.listAdrs();
    expect(adrs.map((x) => x.relPath)).toContain('databank/api/a.md');
    expect(adrs.map((x) => x.relPath)).not.toContain('databank/auth/a.md');
  });

  it('throws NotFound for a missing source', async () => {
    const api = await createRealApi(root, { SLOOP_DRY_RUN: '1' } as NodeJS.ProcessEnv);
    await expect(api.moveAdr('databank/nope.md', 'databank/x.md')).rejects.toBeInstanceOf(NotFound);
  });

  it('throws Conflict on a destination collision', async () => {
    await fs.writeFile(path.join(root, 'databank/auth/b.md'), '---\nid: b\ntitle: B\n---\n', 'utf8');
    const api = await createRealApi(root, { SLOOP_DRY_RUN: '1' } as NodeJS.ProcessEnv);
    await expect(api.moveAdr('databank/auth/a.md', 'databank/auth/b.md')).rejects.toBeInstanceOf(
      Conflict,
    );
  });
});
```

Note: if `createRealApi`'s signature differs from `(root, env)`, mirror the construction
used in `src/server/api/real.test.ts` (it calls `createRealApi(workspace, ...)`); keep the
three assertions identical.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/api/move.test.ts`
Expected: FAIL — `Conflict` is not exported and `api.moveAdr` is not a function.

- [ ] **Step 3: Extend the contract**

In `src/server/api/contract.ts`, add the route to the header comment table (after the `PUT /api/adrs/:relPath` line):

```
//   POST /api/adrs/:relPath/move   -> { ok: true }                 body: MoveAdrRequest
```

Add the request/response types (after `PutAdrResponse`):

```typescript
/** POST /api/adrs/:relPath/move — `:relPath` is the source; `to` is the destination
 *  path (both databank-prefixed). Serves file move, file rename, and folder move. */
export interface MoveAdrRequest {
  to: string;
}
export type MoveAdrResponse = Ok;
```

Add to the `SloopApi` interface (after `putAdr`):

```typescript
  moveAdr(from: string, to: string): Promise<MoveAdrResponse>;
```

- [ ] **Step 4: Implement `Conflict` + `moveAdr` in `real.ts`**

In `src/server/api/real.ts`, next to `export class NotFound extends Error {}` add:

```typescript
export class Conflict extends Error {}
```

Add an import of `MoveError` from the files service (alongside the existing files-service import):

```typescript
import { MoveError } from '../files/filesService';
```

Add the method to `class RealApi` (after `putAdr`):

```typescript
  async moveAdr(from: string, to: string): Promise<Ok> {
    try {
      await this.files.moveAdr(from, to);
    } catch (err) {
      if (err instanceof MoveError) {
        if (err.code === 'not_found') throw new NotFound(err.message);
        throw new Conflict(err.message); // 'conflict' | 'invalid'
      }
      throw err;
    }
    return OK;
  }
```

- [ ] **Step 5: Implement `Conflict` + `moveAdr` in `mock.ts`**

In `src/server/api/mock.ts`, next to `export class NotFound extends Error {}` add:

```typescript
export class Conflict extends Error {}
```

Add the method to `class MockApi` (after `putAdr`), rewriting in-memory relPaths:

```typescript
  async moveAdr(from: string, to: string): Promise<Ok> {
    if (from === to) return OK;
    const isFile = this.adrs.some((a) => a.relPath === from);
    const isFolder = this.adrs.some((a) => a.relPath.startsWith(`${from}/`));
    if (!isFile && !isFolder) throw new NotFound(`Nothing to move at: ${from}`);

    if (isFolder) {
      if (to === from || to.startsWith(`${from}/`)) {
        throw new Conflict(`Cannot move ${from} into its own subtree`);
      }
      const rewrite = (p: string) => `${to}/${p.slice(from.length + 1)}`;
      const targets = this.adrs
        .filter((a) => a.relPath.startsWith(`${from}/`))
        .map((a) => rewrite(a.relPath));
      if (targets.some((t) => this.adrs.some((a) => a.relPath === t))) {
        throw new Conflict(`Destination already exists under: ${to}`);
      }
      for (const adr of this.adrs) {
        if (adr.relPath.startsWith(`${from}/`)) adr.relPath = rewrite(adr.relPath);
      }
      return OK;
    }

    if (this.adrs.some((a) => a.relPath === to)) {
      throw new Conflict(`Destination already exists: ${to}`);
    }
    const adr = this.adrs.find((a) => a.relPath === from)!;
    adr.relPath = to;
    return OK;
  }
```

- [ ] **Step 6: Add the route + 409 funnel in `index.ts`**

In `src/server/index.ts`, update the import from `./api/real` to also pull in `Conflict`:

```typescript
import { createRealApi, NotFound as RealNotFound, Conflict as RealConflict, type StreamingSloopApi } from './api/real';
```

And the import from `./api/mock`:

```typescript
import { MockApi, NotFound as MockNotFound, Conflict as MockConflict } from './api/mock';
```

Add an `isConflict` helper next to `isNotFound`:

```typescript
/** Both backends throw their own Conflict; treat either as a 409. */
function isConflict(err: unknown): boolean {
  return err instanceof MockConflict || err instanceof RealConflict;
}
```

Add the route after the existing `app.put('/api/adrs/:relPath', ...)` block:

```typescript
  app.post('/api/adrs/:relPath/move', h(async (req, res) =>
    res.json(await api.moveAdr(decodeURIComponent(req.params.relPath), String(req.body?.to ?? ''))),
  ));
```

In the error funnel middleware, add the 409 branch before the 500 fallthrough (after the `isNotFound` branch):

```typescript
    if (isConflict(err)) {
      res.status(409).json({ error: err instanceof Error ? err.message : 'conflict' });
      return;
    }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run src/server/api/move.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add src/server/api/contract.ts src/server/api/real.ts src/server/api/mock.ts src/server/index.ts src/server/api/move.test.ts
git commit -m "feat(api): POST /api/adrs/:relPath/move with 409 conflict handling"
```

---

## Task 3: Typed api-client `moveAdr`

**Files:**
- Modify: `src/web/api-client/index.ts`

- [ ] **Step 1: Add the client function**

In `src/web/api-client/index.ts`, after the `getAdrDiff` export (line ~39):

```typescript
/** Move/rename an ADR file, or a whole folder prefix. `from`/`to` are databank-prefixed
 *  paths (e.g. `databank/auth/a.md`). Folder moves carry all descendants. */
export const moveAdr = (from: string, to: string): Promise<Ok> =>
  http(`/adrs/${enc(from)}/move`, { method: 'POST', body: JSON.stringify({ to }) });
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors from `src/web/api-client/index.ts`. (`Ok` is already imported at the top of the file from `../../server/api/contract`.)

- [ ] **Step 3: Commit**

```bash
git add src/web/api-client/index.ts
git commit -m "feat(api-client): moveAdr"
```

---

## Task 4: Pure path-math helpers for the tree (node-testable)

The web test env is `node` (no DOM), so all move/rename path computation lives in a pure
module that the React components call. This is where the drop-target and rename math is
tested.

**Files:**
- Create: `src/web/shell/movePaths.ts`
- Test: `src/web/shell/movePaths.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/web/shell/movePaths.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  fileMoveTarget,
  folderMoveTarget,
  fileRenameTarget,
  folderRenameTarget,
  isRedundantMove,
} from './movePaths';

describe('movePaths', () => {
  it('fileMoveTarget joins the basename onto the destination folder', () => {
    expect(fileMoveTarget('databank/auth/a.md', 'databank/api')).toBe('databank/api/a.md');
    expect(fileMoveTarget('databank/auth/a.md', 'databank')).toBe('databank/a.md');
  });

  it('folderMoveTarget joins the folder name onto the destination folder', () => {
    expect(folderMoveTarget('databank/auth', 'databank/api')).toBe('databank/api/auth');
    expect(folderMoveTarget('databank/auth/oauth', 'databank')).toBe('databank/oauth');
  });

  it('fileRenameTarget swaps the slug, keeping the dir and .md suffix', () => {
    expect(fileRenameTarget('databank/auth/a.md', 'Better Name')).toBe('databank/auth/better-name.md');
    expect(fileRenameTarget('databank/a.md', 'b')).toBe('databank/b.md');
  });

  it('folderRenameTarget swaps the last segment', () => {
    expect(folderRenameTarget('databank/auth/oauth', 'OIDC')).toBe('databank/auth/oidc');
    expect(folderRenameTarget('databank/auth', 'identity')).toBe('databank/identity');
  });

  it('isRedundantMove flags same-parent file moves and folder self/descendant drops', () => {
    expect(isRedundantMove('file', 'databank/auth/a.md', 'databank/auth')).toBe(true); // same parent
    expect(isRedundantMove('file', 'databank/auth/a.md', 'databank/api')).toBe(false);
    expect(isRedundantMove('folder', 'databank/auth', 'databank/auth')).toBe(true); // onto self
    expect(isRedundantMove('folder', 'databank/auth', 'databank/auth/oauth')).toBe(true); // descendant
    expect(isRedundantMove('folder', 'databank/auth', 'databank')).toBe(true); // same parent
    expect(isRedundantMove('folder', 'databank/auth', 'databank/api')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/web/shell/movePaths.test.ts`
Expected: FAIL — module `./movePaths` not found.

- [ ] **Step 3: Implement the helpers**

Create `src/web/shell/movePaths.ts`:

```typescript
// Pure path math for Databank drag-to-move and rename. No I/O, no React — so it can be
// unit-tested under the node test env. All paths are databank-prefixed (e.g.
// `databank/auth/a.md`); the tree root folder is `databank`.

import { slugify } from './createItem';

/** Last `/`-segment of a path. */
function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

/** Everything before the last `/`-segment. */
function dirname(p: string): string {
  return p.slice(0, p.lastIndexOf('/'));
}

/** Destination relPath when a file is dropped into `destFolder`. */
export function fileMoveTarget(fileRelPath: string, destFolder: string): string {
  return `${destFolder}/${basename(fileRelPath)}`;
}

/** Destination folder path when a folder is dropped into `destFolder`. */
export function folderMoveTarget(folderPath: string, destFolder: string): string {
  return `${destFolder}/${basename(folderPath)}`;
}

/** Destination relPath when a file is renamed to display name `name`. */
export function fileRenameTarget(fileRelPath: string, name: string): string {
  return `${dirname(fileRelPath)}/${slugify(name)}.md`;
}

/** Destination folder path when a folder is renamed to display name `name`. */
export function folderRenameTarget(folderPath: string, name: string): string {
  return `${dirname(folderPath)}/${slugify(name)}`;
}

/** True when a drop should be ignored: a no-op (same parent) or an illegal folder move
 *  onto itself or one of its descendants. */
export function isRedundantMove(
  kind: 'file' | 'folder',
  sourcePath: string,
  destFolder: string,
): boolean {
  if (kind === 'file') {
    return dirname(sourcePath) === destFolder;
  }
  if (destFolder === sourcePath || destFolder.startsWith(`${sourcePath}/`)) return true; // self/descendant
  return dirname(sourcePath) === destFolder; // already there
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/web/shell/movePaths.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/web/shell/movePaths.ts src/web/shell/movePaths.test.ts
git commit -m "feat(shell): pure path helpers for databank move/rename"
```

---

## Task 5: Install @dnd-kit

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install the runtime deps**

Run: `npm install @dnd-kit/core@^6 @dnd-kit/utilities@^3`
Expected: both added under `dependencies`; lockfile updated; no peer-dep errors against React 18.3.

- [ ] **Step 2: Verify the install resolves**

Run: `node -e "require('@dnd-kit/core'); require('@dnd-kit/utilities'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add @dnd-kit/core and @dnd-kit/utilities"
```

---

## Task 6: DatabankTree — drag/drop + double-click rename

Adds DnD and rename to the tree. The tree now needs each file's raw `relPath` (today
`FileLeaf` only carries `title`/`to`), folder drop targets, draggable rows, a drag overlay,
and an inline rename input reusing the existing `FolderNameInput` pattern.

**Files:**
- Modify: `src/web/shell/DatabankTree.tsx`

- [ ] **Step 1: Add `relPath` to the file leaf and a folder relPath helper**

In `src/web/shell/DatabankTree.tsx`, extend `FileLeaf`:

```typescript
interface FileLeaf {
  title: string;
  to: string;
  relPath: string; // databank-prefixed, e.g. databank/auth/a.md — the drag source + move identity
}
```

In `buildTree`, set `relPath` when pushing the leaf (replace the existing `node.files.push(...)` call):

```typescript
    node.files.push({
      title: adr.title || fileName,
      to: `/databank/${dirPrefix}${enc(fileName)}`,
      relPath: adr.relPath,
    });
```

Add a folder-path helper near the top (after `const enc = encodeURIComponent;`):

```typescript
/** A folder node's databank-prefixed path. The root node ('') maps to `databank`. */
const folderRelPath = (nodePath: string) => (nodePath ? `databank/${nodePath}` : 'databank');
```

- [ ] **Step 2: Replace the imports and extend `DatabankTreeProps`**

Replace the top imports of `DatabankTree.tsx`:

```typescript
import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { AdrDoc } from '../api-client/index';
import { IconButton, cx } from '../design/index';
import {
  fileMoveTarget,
  folderMoveTarget,
  fileRenameTarget,
  folderRenameTarget,
  isRedundantMove,
} from './movePaths';
```

Extend `DatabankTreeProps` (add after `onNewFolder`):

```typescript
  /** Move/rename: `from`/`to` are databank-prefixed paths. */
  onMove: (from: string, to: string) => void;
```

- [ ] **Step 3: Wire `DndContext` + `DragOverlay` into `DatabankTree`**

Replace the entire `DatabankTree` function. The drag id format is `"<kind>:<path>"`
(e.g. `file:databank/auth/a.md`, `folder:databank/auth`); the droppable id is
`"drop:<folderPath>"`.

```typescript
export function DatabankTree({
  adrs,
  onNewItem,
  onNewFolder,
  onMove,
  rootAdding,
  onRootAddingDone,
}: DatabankTreeProps) {
  const root = buildTree(adrs);
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const onDragStart = (e: DragStartEvent) => {
    setDragLabel(String(e.active.data.current?.label ?? ''));
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDragLabel(null);
    const over = e.over;
    if (!over) return;
    const [kind, sourcePath] = String(e.active.id).split(/:(.+)/) as ['file' | 'folder', string];
    const destFolder = String(over.id).replace(/^drop:/, '');
    if (isRedundantMove(kind, sourcePath, destFolder)) return;
    const to =
      kind === 'file'
        ? fileMoveTarget(sourcePath, destFolder)
        : folderMoveTarget(sourcePath, destFolder);
    onMove(sourcePath, to);
  };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <RootDrop>
        <div className="space-y-0.5">
          {rootAdding && (
            <FolderNameInput
              depth={0}
              onSubmit={(name) => {
                onNewFolder('', name);
                onRootAddingDone();
              }}
              onCancel={onRootAddingDone}
            />
          )}
          {root.folders.map((f) => (
            <Folder
              key={f.path}
              node={f}
              depth={0}
              onNewItem={onNewItem}
              onNewFolder={onNewFolder}
              onMove={onMove}
            />
          ))}
          {root.files.map((leaf) => (
            <FileRow key={leaf.to} leaf={leaf} depth={0} onMove={onMove} />
          ))}
          {root.folders.length === 0 && root.files.length === 0 && !rootAdding && (
            <p className="px-2 py-1 text-[12px] text-ink-subtle">No entries yet</p>
          )}
        </div>
      </RootDrop>
      <DragOverlay>
        {dragLabel != null && (
          <div className="rounded-md bg-paper px-2 py-1 text-[13px] text-ink shadow-md ring-1 ring-line">
            {dragLabel}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** The whole tree body is a drop target for moving items back to the databank root. */
function RootDrop({ children }: { children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'drop:databank' });
  return (
    <div ref={setNodeRef} className={cx('rounded-md', isOver && 'ring-1 ring-accent/50')}>
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Make `Folder` a draggable, a drop target, and renamable**

Replace the `Folder` component with this version (adds `onMove` prop, draggable header,
droppable wrapper, and double-click rename):

```typescript
function Folder({
  node,
  depth,
  onNewItem,
  onNewFolder,
  onMove,
}: {
  node: FolderNode;
  depth: number;
  onNewItem: (folder: string) => void;
  onNewFolder: (parent: string, name: string) => void;
  onMove: (from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const relPath = folderRelPath(node.path);

  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `drop:${relPath}` });
  const {
    setNodeRef: setDragRef,
    listeners,
    attributes,
    isDragging,
  } = useDraggable({ id: `folder:${relPath}`, data: { label: node.name } });

  if (renaming) {
    return (
      <RenameInput
        depth={depth}
        initial={node.name}
        onSubmit={(name) => {
          setRenaming(false);
          onMove(relPath, folderRenameTarget(relPath, name));
        }}
        onCancel={() => setRenaming(false)}
      />
    );
  }

  return (
    <div ref={setDropRef} className={cx('rounded-md', isOver && 'ring-1 ring-accent/50')}>
      <div className={cx('group/row flex items-center rounded-md hover:bg-line-soft', isDragging && 'opacity-50')}>
        <button
          type="button"
          ref={setDragRef}
          {...attributes}
          {...listeners}
          onClick={() => setOpen((v) => !v)}
          onDoubleClick={(e) => {
            e.preventDefault();
            setRenaming(true);
          }}
          style={indent(depth)}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-1 text-[13px] text-ink-muted"
        >
          <span
            aria-hidden
            className={cx(
              'text-[9px] leading-none text-ink-faint transition-transform',
              open ? 'rotate-90' : 'rotate-0',
            )}
          >
            ▶
          </span>
          <span className="truncate font-medium">{node.name}</span>
        </button>
        <div className="flex shrink-0 items-center pr-1 opacity-0 transition-opacity group-hover/row:opacity-100">
          <IconButton aria-label={`New entry in ${node.name}`} onClick={() => onNewItem(node.path)}>
            <span className="text-[13px] leading-none">＋</span>
          </IconButton>
          <IconButton
            aria-label={`New folder in ${node.name}`}
            onClick={() => {
              setOpen(true);
              setAdding(true);
            }}
          >
            <span className="text-[12px] leading-none">🗀</span>
          </IconButton>
        </div>
      </div>

      {open && (
        <div className="space-y-0.5">
          {adding && (
            <FolderNameInput
              depth={depth + 1}
              onSubmit={(name) => {
                onNewFolder(node.path, name);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          )}
          {node.folders.map((f) => (
            <Folder
              key={f.path}
              node={f}
              depth={depth + 1}
              onNewItem={onNewItem}
              onNewFolder={onNewFolder}
              onMove={onMove}
            />
          ))}
          {node.files.map((leaf) => (
            <FileRow key={leaf.to} leaf={leaf} depth={depth + 1} onMove={onMove} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Make `FileRow` draggable + renamable**

Replace the `FileRow` component:

```typescript
function FileRow({
  leaf,
  depth,
  onMove,
}: {
  leaf: FileLeaf;
  depth: number;
  onMove: (from: string, to: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const {
    setNodeRef,
    listeners,
    attributes,
    isDragging,
  } = useDraggable({ id: `file:${leaf.relPath}`, data: { label: leaf.title } });

  if (renaming) {
    return (
      <RenameInput
        depth={depth + 1}
        initial={leaf.title}
        onSubmit={(name) => {
          setRenaming(false);
          onMove(leaf.relPath, fileRenameTarget(leaf.relPath, name));
        }}
        onCancel={() => setRenaming(false)}
      />
    );
  }

  return (
    <NavLink
      to={leaf.to}
      title={leaf.title}
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onDoubleClick={(e) => {
        e.preventDefault();
        setRenaming(true);
      }}
      style={indent(depth + 1)}
      className={({ isActive }) =>
        cx(
          'block truncate rounded-md py-1 pr-2 text-[13px] transition-colors',
          isDragging && 'opacity-50',
          isActive ? 'bg-active font-medium text-ink' : 'text-ink-muted hover:bg-line-soft',
        )
      }
    >
      {leaf.title}
    </NavLink>
  );
}
```

- [ ] **Step 6: Add the `RenameInput` component**

Add after `FolderNameInput` (it differs only in seeding an initial value):

```typescript
function RenameInput({
  depth,
  initial,
  onSubmit,
  onCancel,
}: {
  depth: number;
  initial: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const commit = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== initial) onSubmit(trimmed);
    else onCancel();
  };
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') onCancel();
      }}
      style={indent(depth + 1)}
      className="block w-full rounded-md border border-line bg-paper py-1 pr-2 text-[13px] text-ink outline-none"
    />
  );
}
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors from `DatabankTree.tsx`. If `ref` on `NavLink` is rejected by the
types, wrap the row: render the `NavLink` inside a `<div ref={setNodeRef} {...attributes} {...listeners}>`
and move `onDoubleClick`/`isDragging` styling to that wrapper instead.

- [ ] **Step 8: Commit**

```bash
git add src/web/shell/DatabankTree.tsx
git commit -m "feat(shell): drag-to-move and double-click rename in DatabankTree"
```

---

## Task 7: SidebarNav — own the move handler, refresh, and reroute the open editor

**Files:**
- Modify: `src/web/shell/SidebarNav.tsx`

- [ ] **Step 1: Add the `moveAdr` import**

In `src/web/shell/SidebarNav.tsx`, add `moveAdr` to the api-client import list (the block importing `getAdrs`, etc.):

```typescript
import {
  getAdrs,
  getCascades,
  getRoles,
  getTemplates,
  moveAdr,
  type AdrDoc,
  type CascadeSummary,
  type RoleDef,
  type TemplateDef,
} from '../api-client/index';
```

- [ ] **Step 2: Add the move handler**

In the `SidebarNav` component, after the existing `newLib` handler (around line 178), add:

```typescript
  // Move/rename a databank entry (file or folder prefix). On success, re-fetch the tree;
  // if the currently-open ADR was the one moved, follow it to its new URL so the editor
  // doesn't 404. `from`/`to` are databank-prefixed paths (e.g. databank/auth/a.md).
  const moveDatabank = (from: string, to: string) => {
    const openPath = decodeURIComponent(location.pathname.replace(/^\/databank\//, ''));
    const openRel = `databank/${openPath}`;
    const toUrl = (rel: string) => `/databank/${rel.replace(/^databank\//, '')}`;
    void moveAdr(from, to)
      .then(() => getAdrs())
      .then((next) => {
        setAdrs(next);
        // File rename/move: exact match. Folder move: the open file sat under `from/`.
        if (openRel === from) {
          navigate(toUrl(to));
        } else if (openRel.startsWith(`${from}/`)) {
          navigate(toUrl(`${to}/${openRel.slice(from.length + 1)}`));
        }
      })
      .catch(fail('adrs'));
  };
```

- [ ] **Step 3: Pass `onMove` to `DatabankTree`**

In the `DatabankTree` element (around line 215), add the prop:

```typescript
          <DatabankTree
            adrs={adrs}
            onNewItem={newAdr}
            onNewFolder={newFolder}
            onMove={moveDatabank}
            rootAdding={rootAddingFolder}
            onRootAddingDone={() => setRootAddingFolder(false)}
          />
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors from `SidebarNav.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/web/shell/SidebarNav.tsx
git commit -m "feat(shell): wire databank move handler with refresh and reroute"
```

---

## Task 8: Full verification

- [ ] **Step 1: Run the whole test suite**

Run: `npx vitest run`
Expected: all tests pass, including the new `moveAdr`, `move.test.ts`, and `movePaths` tests.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors introduced by this work. (Pre-existing unrelated diagnostics in the in-progress `src/cli/` and design-token refactor are out of scope — if unsure whether an error is pre-existing, compare against `main` with `git stash` before Task 1.)

- [ ] **Step 3: Manual smoke test (mock backend; no DOM test harness exists)**

Run: `SLOOP_MOCK=1 npm run dev` (or the project's dev script), then in the browser:
1. Drag a Databank file from one folder onto another folder header → it moves; the source folder collapses away if now empty.
2. Drag a file onto the Databank root area → it moves to the top level.
3. Drag a folder onto another folder → the whole subtree moves.
4. Double-click a file → rename it → the row relabels and the URL updates if it was open.
5. Try to drop a folder onto itself or a descendant → nothing happens.
6. Rename a file to collide with an existing one → a 409 surfaces via the existing error path; no crash.

Expected: all behaviors as described; no console errors.

- [ ] **Step 4: Final commit (only if the smoke test required tweaks)**

```bash
git add -A
git commit -m "fix: address databank move/rename smoke-test findings"
```

---

## Self-review notes

- **Spec coverage:** move file (Tasks 1–2, 6–7), move folder (Tasks 1–2, 6–7), rename file (Tasks 4, 6), rename folder (Tasks 4, 6), `@dnd-kit` DnD (Tasks 5–6), guards collision/cycle/traversal (Tasks 1–2), refresh + reroute (Task 7), filesystem-not-git persistence (Task 1), out-of-scope items untouched. ✅
- **Type consistency:** `moveAdr(from, to)` signature is identical across `FilesService`, `SloopApi`, `RealApi`, `MockApi`, and the api-client. `MoveError.code` ∈ `{not_found, conflict, invalid}` is consumed in `real.ts`. Drag id format `"<kind>:<path>"` and droppable id `"drop:<folder>"` are produced and parsed only in `DatabankTree.tsx`. Helper names (`fileMoveTarget`, `folderMoveTarget`, `fileRenameTarget`, `folderRenameTarget`, `isRedundantMove`) match between `movePaths.ts`, its test, and `DatabankTree.tsx`.
- **Placeholders:** none — every code step shows complete code.
