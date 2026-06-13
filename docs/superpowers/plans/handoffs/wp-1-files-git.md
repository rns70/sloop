# Handoff — WP-1: Files + Git (backend)

> **Stage 2 — parallel. Depends on WP-0 being merged. Runs alongside WP-2/3/4/5.**

## Before you start
Read the spec (§4.2 file layout, §4.3 loop schema) and the build overview. WP-0 has frozen `src/shared/` — import types from there, never redefine them. Branch: `wp-1-files-git`.

## Your goal
Implement the real `FilesService` and `GitService` from `src/shared/services.ts` against a workspace folder on disk. This is how every loop/ADR is read and written as markdown-with-frontmatter, and how the cascade detects what changed.

## You own
- `src/server/files/` — `filesService.ts`, `frontmatter.ts`, and tests.
- `src/server/git/` — `gitService.ts` and tests.
Do not touch `src/shared`, `src/server/api`, or any frontend code.

## Tasks
1. `frontmatter.ts`: thin wrappers over `gray-matter` to (a) parse a markdown string into `{ data, body }` and (b) serialize a `LoopDoc`/`AdrDoc` back to `---`-fenced markdown. Round-trip must be stable (parse→serialize→parse equal).
2. `filesService.ts`: implement `FilesService`. Resolve the workspace root from env `SLOOP_WORKSPACE` (default `fixtures/sample-workspace`). On-disk frontmatter keys are **camelCase, identical to the shared TS interfaces** (`acceptanceCriteria`, `sourceAdr`, …), so `gray-matter` data maps onto the types with no key remapping. Map between disk markdown and the shared types:
   - `listAdrs`/`readAdr`/`writeAdr` over `databank/*.md` — pull `title` + `acceptanceCriteria` (with stable ids + `verify`) out of frontmatter.
   - `readLoop`/`writeLoop`/`listLoops(cascadeId)` over `cascades/<id>/**.md` — `writeLoop` writes to `loop.relPath`, creating dirs.
   - `listTemplates`/`listRoles` over `.sloop/templates/*.md` and `.sloop/roles/*.md` → `TemplateDef`/`RoleDef`.
3. `gitService.ts`: implement `GitService` with `simple-git` rooted at the workspace.
   - `diffDatabank()`: diff the `databank/` working tree against the last commit; return `DatabankDiff` with `before`/`after` content and a `delta` per changed file (`add`/`change`/`delete` from git status).
   - `commitAll(message)`: stage all, commit, return short sha. Use a fixed author so it works without global git config.
4. Tests (vitest) using a temp dir workspace: frontmatter round-trip; write-then-read a loop; `diffDatabank` detects an added/changed/deleted ADR; `commitAll` produces a 7-char sha and two commits differ.

## Definition of done
- `npm run typecheck` clean; `npm test` green for your files.
- A quick manual check documented in your PR: point `SLOOP_WORKSPACE` at a scratch copy, edit an ADR, call `diffDatabank()` → shows the change.
- `FilesService` and `GitService` are exported so WP-6 can construct them.

## Handoff
WP-2 (cascade) and WP-6 (integration) consume these. Export concrete classes/factories: `createFilesService(root?)`, `createGitService(root?)`.
