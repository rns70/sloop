# Rename "templates" to "workflows" — Design Document

**Date:** 2026-06-13
**Status:** Approved
**Author:** Jelle Maas (with Claude)

> Supersedes the "process templates" concept in §6 of
> `2026-06-13-sloop-design.md`. This is a naming + conceptual correction, not a new
> runtime mechanism.

---

## 1. Problem

sloop's `.sloop/templates/` directory conflates two different kinds of thing under one
name:

- **Methodologies** — `spec-driven`, `waterfall`, `tdd`. These describe *how to run an
  entire development cycle*: the ordered phases and which role/model staffs each.
- **Activities** — `migrate`, `debug`. These are *kinds of work that happen inside* a
  cycle (a behavior-preserving refactor; a reproduce-first defect repair). They are not
  whole methodologies; they are steps of one.

Treating all five as peer "templates" is a category error. The word "template" is also
weaker than the concept deserves: what the architect instantiates is a **workflow** — a
way to go about a development cycle.

## 2. Decision

Rename the concept **template → workflow** and **stages → steps**, and keep the model
**single-level**: a workflow is a methodology whose steps are declared inline in its
frontmatter (exactly as `stages` are today). There is no separate step-library
abstraction.

`migrate` and `debug` stop being standalone workflows. Their hard-won guidance is
preserved by folding it into the methodology where it naturally belongs, so nothing
valuable is lost.

### 2.1 The workflow set (4 methodologies)

| Workflow | Steps | Notes |
|----------|-------|-------|
| `spec-driven` *(default)* | plan → implement → verify | unchanged |
| `waterfall` | requirements → design → implement → verify *(gate)* → deploy | **absorbs `migrate`**: behavior-preserving migrations are the canonical waterfall case — survey/codemod-first, with the *existing* test suite as the locked oracle. |
| `tdd` | write-failing-test *(gate)* → implement → refactor *(gate)* | **absorbs `debug`**: defect repair is reproduce-first — a failing regression test *is* the failing-test step. |
| `agile` | plan → implement → verify, looped per story | **new**: lightweight iterative cycle for incremental, story-sized deltas. |

`migrate.md` and `debug.md` are deleted.

## 3. Vocabulary changes

| Old | New |
|-----|-----|
| template (concept) | workflow |
| `.sloop/templates/` | `.sloop/workflows/` |
| `TemplateDef` | `WorkflowDef` |
| `TemplateDef.stages` | `WorkflowDef.steps` |
| `LoopFrontmatter.template` | `LoopFrontmatter.workflow` |
| `CascadeSummary.template` | `CascadeSummary.workflow` |
| `AssistantAction` `'create-template'` | `'create-workflow'` |
| frontmatter key `stages:` | `steps:` |
| frontmatter key `template:` (loops, cascades) | `workflow:` |

## 4. Scope

Full rename across the whole repo, in one pass — concept, data, code, and docs.

### 4.1 Workflow markdown (3 copies)
`git mv` `.sloop/templates/` → `.sloop/workflows/` in each of:
`.sloop/`, `assets/init-template/.sloop/`, `fixtures/sample-workspace/.sloop/`.
Rewrite the 4 surviving files (`stages:`→`steps:`, fold migrate/debug guidance, add
`agile.md`); delete `migrate.md` and `debug.md` in all three copies.

### 4.2 Code (~20 modules + their tests)
- `src/shared/types.ts` — `WorkflowDef`, `.steps`, `LoopFrontmatter.workflow`,
  `CascadeSummary.workflow`, `AssistantAction` union.
- `src/shared/services.ts`, `src/server/api/{contract,mock,real}.ts`,
  `src/server/planner/{architect,prompt}.ts`, `src/server/cascade/cascadeEngine.ts`,
  `src/server/files/filesService.ts`, `src/server/assistant/{prompt,envelope}.ts`,
  `src/server/buildServer.ts`, `src/cli/scaffold.ts` (dir path + workflow list),
  `src/eval/{repo,runner,cli}.ts`,
  `src/web/{assistant/planWrite,shell/createItem,api-client/index}.ts`.
- All `*.test.ts` referencing the renamed symbols, fields, or the directory path.

### 4.3 Workspace data & docs
- All `_cascade.md` and loop files (`databank`-driven cascade + fixtures cascades):
  frontmatter `template:` → `workflow:`.
- `databank/adr-011-roles-and-templates.md` → retitle "roles and workflows"; update body;
  fix `ac-1` verify path `.sloop/templates` → `.sloop/workflows`. (File renamed to
  `adr-011-roles-and-workflows.md`.)
- `README.md` conventions and `2026-06-13-sloop-design.md` §6 terminology.

## 5. Out of scope (YAGNI)

- A first-class reusable **step library** (`.sloop/steps/`) that workflows compose by id.
  Considered and rejected for now: steps stay inline. Revisit only if step reuse across
  workflows becomes real.
- Any change to the convergence invariant, gating, or execution engine. This is a rename
  + reclassification; runtime behavior is unchanged.

## 6. Risks & verification

**Concurrency risk.** A separate work package is actively editing shared modules
(`src/shared/types.ts`, `src/server/api/real.ts`, …) as part of an in-flight `moveAdr`
migration. A repo-wide rename of those files can collide or be clobbered in the shared
checkout. Mitigation: snapshot `git status` immediately before editing; if a target file
is dirty from the other WP, surface the conflict instead of fighting it.

**Verification.**
1. `npm run typecheck` and `npm test` green (separating any pre-existing `moveAdr`
   breakage from regressions this change introduces).
2. `node scripts/verify-self-databank.mjs` — `adr-011`'s updated verify path resolves and
   the snapshot stays honest (no new mismatches).
3. Grep guard: no stray `TemplateDef`, `\.sloop/templates`, or frontmatter `template:` /
   `stages:` remain outside historical docs.

## 7. Rollback

Single squashable change set. Rollback = `git revert` of the rename commit(s); the
directory move is reversible via `git mv` back. No data migration beyond the frontmatter
key rename, which is mechanical and reversible.
