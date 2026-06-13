# Loops hierarchy + hardcoded seed (port from dev-rens)

Date: 2026-06-13
Status: approved

## Problem

dev-rens ships a hardcoded initial workspace whose authored markdown docs form a
loop hierarchy: each `.md` declares its children in frontmatter, and those children
define the tree sloop plans and executes (PRD → architecture → implementation-plan →
build). Our branch instead seeds a single `databank/adr-001-example.md` and links the
hierarchy by **child id**. We want dev-rens's hardcoded tree, expressed in our
conventions, with the hierarchy declared by **child path** in frontmatter.

## Decisions (from brainstorming)

1. **Seed:** the hardcoded dev-rens `loops/` tree replaces the `databank/adr-001-example.md`
   seed as the primary scaffold output.
2. **Hierarchy field:** each md declares `children: [relative paths]` (workspace-root-
   relative, e.g. `loops/architecture/architecture.md`), porting dev-rens's `stages[].doc`
   path semantics onto our `children` key.
3. **Model:** `loops/` IS the databank — rename/repurpose the `databank/` authored-
   hierarchy folder to `loops/`, and repoint the resolvers (`AdrRunTree`, `RunPanel`,
   `adrRunner.planRunSet`) to link children **by relPath** instead of by id.

## Scope

- **Seed** (`assets/init-template/`): drop `databank/adr-001-example.md`; add
  `loops/PRD.md`, `loops/architecture/architecture.md`, `loops/plans/implementation-plan.md`,
  `loops/build/build.md`. Each carries `children: [paths]`; criteria live in the body
  checklist (our existing convention). `build.md` is the leaf (`children: []`, `outputs`).
- **Folder rename** `databank/` → `loops/`, system-wide, as a string/const change:
  `filesService` (`DATABANK_DIR`→`LOOPS_DIR`, traversal guards/messages), `gitService`
  (`DATABANK_PREFIX`), `scaffold`/`cli` help text, `eval/repo`+`eval/types`+`taskLoader`+
  `swebench`, web route `/databank/*`→`/loops/*` and the `databank/` UI prefix across
  `DatabankTree`, `SidebarNav`, `commands`, `createItem`, `AssistantRail`, `AdrEditor`,
  `movePaths`, `runHistory`, `api-client`, `EmptyPane`, `InlineDiff`, assistant
  `prompt`/`tools`, `adrTemplate`.
- **Resolvers**: children link by **relPath**, not id — `AdrRunTree.getChildren`,
  `RunPanel` run-set collection, `adrRunner.planRunSet`.
- **Fixtures + tests**: move `fixtures/sample-workspace/databank/` → `loops/`; update all
  path literals in the suite; add a path-children resolution test.

## Out of scope (deferred, kept stable to avoid destabilizing the mid-refactor branch)

- Renaming internal type `AdrDoc`, the `/adrs` API endpoints, `FilesService.listAdrs`
  method names, and the `src/web/views/databank/` source-folder name. These are internal
  symbols, not user-visible; a mechanical follow-up can rename them in isolation.
- The execution-unit type `LoopDoc`/`LoopFrontmatter` (executor/eval) is untouched.

## Verification

`npm run typecheck` clean and `npm test` green. A new test asserts that a parent loop
resolves its `children` paths to the child docs and `planRunSet` returns the ordered
subtree by relPath.
