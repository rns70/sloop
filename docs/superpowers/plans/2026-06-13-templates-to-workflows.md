# Templates → Workflows Rename — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename sloop's "template" concept to "workflow" (and `stages`→`steps`) across markdown, code, workspace data, and docs; reduce to 4 methodologies (spec-driven, waterfall, tdd, agile) by folding migrate/debug guidance into waterfall/tdd.

**Architecture:** A wide but mechanical rename. The workflow markdown files and the shared TypeScript contract change first; the rest is a coordinated identifier rename driven by `perl` passes over `src/`, a manual cleanup sweep, then frontmatter-key updates in workspace data and docs. The existing test suite is the safety net — a rename is correct iff `npm run typecheck` and `npm test` stay green.

**Tech Stack:** TypeScript (ESM, Node 20+), Vitest, gray-matter, React/Vite (web), `perl`/`git mv` for the mechanical rename.

---

## ⚠️ Pre-flight: concurrency check

A separate work package is editing shared modules (`src/shared/types.ts`, `src/server/api/real.ts`, `src/server/files/filesService.ts`) as part of an in-flight `moveAdr` migration. Before starting, snapshot the working tree and record a baseline of which failures are pre-existing (not caused by this rename).

- [ ] **Step 0a: Snapshot status**

Run: `git status --short`
Note any `M` files under `src/` — those are the other WP's in-flight edits. Do not revert them.

- [ ] **Step 0b: Record the pre-existing failure baseline**

Run: `npm run typecheck 2>&1 | tail -20; npm test 2>&1 | tail -15`
Expected: may already fail with `moveAdr` / `FilesService` errors. Save this list — these specific errors are NOT yours to fix and must be ignored when judging this plan's verification steps. Any NEW error mentioning `template`/`workflow`/`stages`/`steps` IS yours.

---

## Complete rename mapping (single source of truth)

Every later task derives from this table. **DRY:** do not invent variants.

**Identifiers (word-boundary, unique tokens):**

| Old | New |
|-----|-----|
| `TemplateDef` | `WorkflowDef` |
| `GetTemplatesResponse` | `GetWorkflowsResponse` |
| `listTemplates` | `listWorkflows` |
| `getTemplates` | `getWorkflows` |
| `loadTemplates` | `loadWorkflows` |
| `serializeTemplate` | `serializeWorkflow` |
| `setTemplates` | `setWorkflows` |
| `TEMPLATES_DIR` | `WORKFLOWS_DIR` |
| `templateId` | `workflowId` |

**String / path literals:**

| Old | New |
|-----|-----|
| `create-template` | `create-workflow` |
| `/api/templates` | `/api/workflows` |
| `'/templates'` (client http path) | `'/workflows'` |
| `.sloop/templates` | `.sloop/workflows` |

**Lowercase words (boundary-safe):**

| Old | New |
|-----|-----|
| `templates` | `workflows` |
| `template` | `workflow` |
| `stages` | `steps` |
| `stageLines` | `stepLines` |
| `stage` (only where it means a workflow step — planner) | `step` |

**Frontmatter keys (markdown + serializers):** `stages:` → `steps:` (workflow files); `template:` → `workflow:` (loop & cascade files).

---

## Task 1: Workflow markdown files (3 copies)

The three `.sloop/templates/` directories are currently byte-identical. Rename each to `.sloop/workflows/`, rewrite the 4 surviving files with `steps:` + folded guidance, add `agile.md`, delete `migrate.md` and `debug.md`.

**Files:**
- Rename (each copy): `.sloop/templates/` → `.sloop/workflows/` under `./`, `assets/init-template/`, `fixtures/sample-workspace/`
- Rewrite per copy: `spec-driven.md`, `waterfall.md`, `tdd.md`
- Create per copy: `agile.md`
- Delete per copy: `migrate.md`, `debug.md`

- [ ] **Step 1.1: Rename the three directories with git mv**

```bash
git mv .sloop/templates .sloop/workflows
git mv assets/init-template/.sloop/templates assets/init-template/.sloop/workflows
git mv fixtures/sample-workspace/.sloop/templates fixtures/sample-workspace/.sloop/workflows
```

- [ ] **Step 1.2: Delete migrate.md and debug.md in all three copies**

```bash
git rm .sloop/workflows/migrate.md .sloop/workflows/debug.md
git rm assets/init-template/.sloop/workflows/migrate.md assets/init-template/.sloop/workflows/debug.md
git rm fixtures/sample-workspace/.sloop/workflows/migrate.md fixtures/sample-workspace/.sloop/workflows/debug.md
```

- [ ] **Step 1.3: Write `spec-driven.md` (identical content in all 3 copies)**

Only the frontmatter key changes (`stages:`→`steps:`); body unchanged.

```markdown
---
id: spec-driven
name: Spec-driven
steps:
  - { name: plan,      role: architect, model: opus }
  - { name: implement, role: engineer,  model: haiku }
  - { name: verify,    role: qa,         model: sonnet, gate: true }
---

# Spec-driven (default)

The default methodology: **plan → implement → verify**.

1. **plan** — the architect reads the delta and the ADR's acceptance criteria and stamps
   out one implementation leaf per actionable unit. Write each criterion in **EARS form**
   (WHEN/IF/WHILE <trigger>, the system SHALL <response>) so it is unambiguous, and copy
   it onto the owning leaf with a stable id, a concrete `verify` command, and
   `locked: true`. Partition leaves by file — no two leaves edit the same file.
2. **implement** — an engineer leaf makes the smallest change that satisfies its locked
   criteria, without weakening them.
3. **verify** *(gate)* — each criterion's `verify` command runs; QA, a separate agent,
   confirms. A criterion passes only on exit 0.

Keep the tree shallow (architect → leaves, optionally one inner layer). Completion
bubbles up: the root is done iff every leaf is done and its locked criteria pass.
```

- [ ] **Step 1.4: Write `waterfall.md` (identical in all 3 copies) — folds the migrate guidance**

```markdown
---
id: waterfall
name: Waterfall
steps:
  - { name: requirements, role: architect, model: opus }
  - { name: design,       role: architect, model: opus }
  - { name: implement,    role: engineer,  model: sonnet }
  - { name: verify,       role: qa,         model: sonnet, gate: true }
  - { name: deploy,       role: engineer,  model: haiku }
---

# Waterfall

Sequential steps, each gated on the previous: **requirements → design → implement →
verify → deploy**. A step's loops do not start until the prior step's artifact is frozen
and verified.

The value here is **gating discipline**: a frozen, reviewed artifact at each handoff
reduces error propagation between phases. The cost is **latency** — pure sequential
phases serialize work that agents could otherwise interleave. Choose waterfall only when
requirements are genuinely frozen and the phases have hard linear dependencies; prefer
`spec-driven` otherwise.

The **verify** step is the gate: QA confirms each locked criterion on exit 0 before
deploy begins.

## Behavior-preserving migrations

A schema migration or large refactor is the canonical waterfall case — it has hard linear
dependencies and must not change behavior. Run it as: **survey** (an explorer maps every
call site and file the change touches, read-only, and returns the file partition) →
**plan a codemod** (prefer a deterministic codemod/recipe over free-form edits;
mechanical changes should be mechanical, which constrains hallucination) → **apply**
(engineer leaves apply the change, one disjoint file set each) → **verify**. The gate's
oracle is the **existing** test suite (`locked: true`): behavior is preserved iff every
test that passed before still passes.
```

- [ ] **Step 1.5: Write `tdd.md` (identical in all 3 copies) — folds the debug guidance**

```markdown
---
id: tdd
name: Test-driven
steps:
  - { name: write-failing-test, role: engineer, model: sonnet, gate: true }
  - { name: implement,          role: engineer, model: haiku }
  - { name: refactor,           role: engineer, model: haiku, gate: true }
---

# Test-driven

Per unit, loop: **write a failing test → implement to green → refactor**.

1. **write-failing-test** *(gate)* — write a test that encodes the acceptance criterion,
   run it, and confirm it fails for the right reason. Commit the failing test, then
   **lock** it (`locked: true`): that test is the leaf's `verify` command.
2. **implement** — write the smallest code that turns the test green. Do **not** edit the
   test to make it pass — altering a locked test is reward-hacking, not progress. If the
   test looks wrong, escalate upward.
3. **refactor** *(gate)* — improve the code with the suite staying green; the locked test
   must still pass unchanged.

The failing test is the verify gate, so the convergence invariant holds by construction:
the unit is done exactly when its locked test exits 0.

## Defect repair (reproduce-first)

Fixing a bug is TDD applied to a defect: the failing test is a **reproduction**.
**reproduce** — write a failing regression test that triggers the defect and confirm it
fails for the right reason; lock it as the leaf's `verify`. **localize** — trace the
failure to its root cause with `path:line` evidence. **implement/refactor** as above. The
gate is the reproduction test plus the existing suite, both green. Reproducing the bug as
a locked test first is what makes the fix verifiable rather than plausible.
```

- [ ] **Step 1.6: Create `agile.md` (identical in all 3 copies)**

```markdown
---
id: agile
name: Agile
steps:
  - { name: plan,      role: architect, model: sonnet }
  - { name: implement, role: engineer,  model: haiku }
  - { name: verify,    role: qa,         model: sonnet, gate: true }
---

# Agile

Iterative, story-sized delivery — the same **plan → implement → verify** shape as
spec-driven, but deliberately lightweight and looped per story rather than run once over a
frozen spec.

1. **plan** — the architect slices the delta into the smallest shippable stories and
   stamps out one leaf per story, each with a locked, machine-checkable acceptance
   criterion. Planning runs on a cheaper model than waterfall because each slice is small
   and low-risk; escalate a leaf's model only when a story is open-ended.
2. **implement** — an engineer leaf makes the smallest change that satisfies its story's
   locked criterion.
3. **verify** *(gate)* — each story's `verify` command runs; QA confirms on exit 0.

Prefer agile when the work is naturally incremental and requirements may evolve between
slices. Each story converges independently, and completion bubbles up: the root is done
iff every story leaf is done and its locked criterion passes.
```

- [ ] **Step 1.7: Verify the markdown layer**

```bash
ls .sloop/workflows assets/init-template/.sloop/workflows fixtures/sample-workspace/.sloop/workflows
! test -d .sloop/templates && echo "old dir gone"
grep -L 'steps:' .sloop/workflows/*.md || echo "all have steps:"
! grep -rq 'stages:' .sloop/workflows && echo "no stale stages: key"
```
Expected: each dir lists exactly `agile.md spec-driven.md tdd.md waterfall.md`; "old dir gone"; "all have steps:"; "no stale stages: key".

- [ ] **Step 1.8: Commit**

```bash
git add .sloop assets/init-template fixtures/sample-workspace
git commit -m "refactor(workflows): rename .sloop/templates -> workflows; 4 methodologies"
```

---

## Task 2: Shared contract (`src/shared/types.ts`)

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 2.1: Rename the def and its field**

Replace:
```ts
export interface TemplateDef {
  id: string;
  name: string;
  stages: { name: string; role: string; model: string; gate?: boolean }[];
  guidance: string;             // prose the architect follows
}
```
with:
```ts
export interface WorkflowDef {
  id: string;
  name: string;
  steps: { name: string; role: string; model: string; gate?: boolean }[];
  guidance: string;             // prose the architect follows
}
```

- [ ] **Step 2.2: Rename the loop frontmatter field**

In `LoopFrontmatter`, change `template?: string;` to `workflow?: string;`.

- [ ] **Step 2.3: Rename the cascade summary field**

In `CascadeSummary`, change `template: string;` to `workflow: string;`.

- [ ] **Step 2.4: Rename the assistant action**

Change:
```ts
export type AssistantAction = 'answer' | 'edit' | 'create-adr' | 'create-role' | 'create-template';
```
to:
```ts
export type AssistantAction = 'answer' | 'edit' | 'create-adr' | 'create-role' | 'create-workflow';
```

Do NOT typecheck yet — implementers still reference the old names; that is fixed atomically in Task 3.

---

## Task 3: Code-wide identifier rename

Apply the mapping table to all TypeScript under `src/` in one atomic pass, then clean up the ambiguous lowercase cases by hand, then verify. (macOS `perl` is preinstalled; `-i` edits in place.)

**Files:** all `src/**/*.ts` and `src/**/*.tsx` (the passes are scoped by `git ls-files`).

- [ ] **Step 3.1: Rename compound / unique identifiers and literals**

```bash
FILES=$(git ls-files 'src/**/*.ts' 'src/**/*.tsx')
perl -pi -e '
  s/\bTemplateDef\b/WorkflowDef/g;
  s/\bGetTemplatesResponse\b/GetWorkflowsResponse/g;
  s/\blistTemplates\b/listWorkflows/g;
  s/\bgetTemplates\b/getWorkflows/g;
  s/\bloadTemplates\b/loadWorkflows/g;
  s/\bserializeTemplate\b/serializeWorkflow/g;
  s/\bsetTemplates\b/setWorkflows/g;
  s/\bTEMPLATES_DIR\b/WORKFLOWS_DIR/g;
  s/\btemplateId\b/workflowId/g;
  s/create-template/create-workflow/g;
  s{/api/templates}{/api/workflows}g;
  s{\x27/templates\x27}{\x27/workflows\x27}g;
  s{\.sloop/templates}{.sloop/workflows}g;
' $FILES
```

- [ ] **Step 3.2: Rename lowercase plurals, then singular, then the step word**

```bash
FILES=$(git ls-files 'src/**/*.ts' 'src/**/*.tsx')
perl -pi -e 's/\btemplates\b/workflows/g; s/\bstages\b/steps/g;' $FILES
perl -pi -e 's/\btemplate\b/workflow/g;' $FILES
perl -pi -e 's/\bstageLines\b/stepLines/g;' src/server/planner/prompt.ts
perl -pi -e 's/\bstage\b/step/g;' src/server/planner/prompt.ts src/server/planner/architect.ts
```

- [ ] **Step 3.3: Manual cleanup sweep — fix anything the passes mangled**

Run: `grep -rin 'template\|stage' src --include=*.ts --include=*.tsx | grep -v node_modules`
Expected ideal: only intentional residue. Inspect each hit and fix by hand:
  - Any user-facing prose that now reads oddly (e.g. a comment saying "workflow literal" where it meant a JS template literal) — restore the word "template" there. Known candidate: `src/web/design/MarkdownEditor.tsx` (check for "template literal" / unrelated uses).
  - `src/server/cascade/cascadeEngine.ts:82` comment "stage status" → "step status" is fine to leave or adjust.
  - Confirm `summary.workflow`, `frontmatter.workflow`, `workflow.steps`, `workflow.name`, `req.workflowId` all read correctly.

- [ ] **Step 3.4: Fix the assistant-generated workflow stub in `mock.ts`**

`src/server/api/mock.ts` ~line 214 generates a file body with a `stages:` key and a `name: Review Pipeline`. After the passes it should read `steps:`. Confirm the generated content block is now:
```ts
content: `---\nid: ${slug}\nname: Review Pipeline\nsteps:\n  - name: architect\n    role: architect\n    model: opus\n---\n\n${text}\n` };
```
Fix by hand if the pass missed the embedded newline-delimited `stages:`.

- [ ] **Step 3.5: Typecheck**

Run: `npm run typecheck 2>&1 | tail -25`
Expected: no errors that mention `template`, `Template`, `stages`, `workflow`, `Workflow`, or `steps`. (Pre-existing `moveAdr`/`FilesService` errors from Step 0b may remain — ignore only those.)

- [ ] **Step 3.6: Run the test suite**

Run: `npm test 2>&1 | tail -25`
Expected: same pass/fail set as the Step 0b baseline, minus nothing new. Any failure referencing workflows/steps is yours — fix it. Note: tests still assert against fixture data whose frontmatter is updated in Task 4; if `filesService`/`cascadeEngine`/`frontmatter` tests fail on `workflow`/`steps` data, proceed to Task 4 and re-run them there.

- [ ] **Step 3.7: Commit**

```bash
git add src
git commit -m "refactor(workflows): rename TemplateDef/template/stages across code"
```

---

## Task 4: Workspace cascade data (frontmatter `template:` → `workflow:`)

**Files:**
- Modify: `cascades/2026-06-13-reconcile-sloop-to-databank/{_cascade,_architect,wire-depthcap-from-config}.md`
- Modify: `fixtures/sample-workspace/cascades/2026-06-13-token-rotation-sync/{_cascade,_architect,rotate-refresh-tokens,invalidate-on-reuse,review-token-security}.md`

- [ ] **Step 4.1: Rename the frontmatter key in all cascade + loop files**

```bash
perl -pi -e 's/^template:/workflow:/' \
  cascades/2026-06-13-reconcile-sloop-to-databank/*.md \
  fixtures/sample-workspace/cascades/2026-06-13-token-rotation-sync/*.md
```

- [ ] **Step 4.2: Verify no stale key remains in workspace data**

```bash
! grep -rq '^template:' cascades fixtures/sample-workspace/cascades && echo "clean"
grep -rl '^workflow:' cascades fixtures/sample-workspace/cascades
```
Expected: "clean", and the files now list a `workflow:` key.

- [ ] **Step 4.3: Re-run the data-dependent tests**

Run: `npm test -- filesService frontmatter cascadeEngine 2>&1 | tail -20`
Expected: green (modulo the Step 0b `moveAdr` baseline). These read the renamed fixture frontmatter and `.sloop/workflows/` files.

- [ ] **Step 4.4: Commit**

```bash
git add cascades fixtures/sample-workspace/cascades
git commit -m "refactor(workflows): rename template -> workflow in cascade frontmatter"
```

---

## Task 5: Databank ADR-011

**Files:**
- Rename: `databank/adr-011-roles-and-templates.md` → `databank/adr-011-roles-and-workflows.md`
- Modify: the renamed file
- Modify: any `[[adr-011-roles-and-templates]]` backlinks in other ADRs

- [ ] **Step 5.1: git mv the ADR**

```bash
git mv databank/adr-011-roles-and-templates.md databank/adr-011-roles-and-workflows.md
```

- [ ] **Step 5.2: Rewrite the ADR contents**

Replace the whole file with:
```markdown
---
id: adr-011
title: Roles and workflows are orthogonal markdown
acceptanceCriteria:
  - id: ac-1
    text: "Roles and workflows ship as editable markdown files under .sloop/."
    verify: "test -d .sloop/roles && test -d .sloop/workflows"
    passed: true
  - id: ac-2
    text: "The architect instantiates a loop tree following the selected workflow."
    verify: "npm test -- architect"
    passed: true
---

# ADR-011 — Roles and workflows are orthogonal markdown

## Context
Two different concerns are easy to conflate: *who* does the work and *what shape* the
work tree takes. Baking either into code would make personas and methodologies
un-versioned and un-editable by users.

## Decision
**Roles** (`.sloop/roles/*.md`) define *who* — each is a markdown file whose frontmatter
sets defaults (`defaultModel`, `color`) and whose body is the brief the agent receives
(Architect, Engineer, QA, Security, …; user-definable). **Workflows**
(`.sloop/workflows/*.md`) define *the shape of the tree* — a development methodology as an
ordered list of **steps**, each staffed by a role + model (`spec-driven` default, plus
`waterfall`, `tdd`, `agile`). They are orthogonal: a workflow references roles to staff
its steps. Both are plain markdown, so they are versioned, diffable, and editable in the
same shared editor as everything else. Activities like migration and defect repair are
steps within a workflow (folded into `waterfall` and `tdd`), not workflows of their own.

## Consequences
- Users invent methodologies by copying and editing a workflow — no new runtime code.
- Routing, personas, and process all live as reviewable files under git.
- The architect ([[adr-009-pi-execution-engine]]) reads the chosen workflow and stamps
  out child loops to match.
```

- [ ] **Step 5.3: Fix backlinks to the renamed ADR**

```bash
grep -rl 'adr-011-roles-and-templates' databank && \
  perl -pi -e 's/adr-011-roles-and-templates/adr-011-roles-and-workflows/g' databank/*.md || \
  echo "no backlinks"
```

- [ ] **Step 5.4: Re-run the honest-snapshot guard**

Run: `node scripts/verify-self-databank.mjs`
Expected: same as before — `0 mismatch(es)`, and `adr-011/ac-1` shows `passed=true actual=true` with the new `.sloop/workflows` path.

- [ ] **Step 5.5: Commit**

```bash
git add databank
git commit -m "docs(databank): ADR-011 roles and workflows; fix verify path"
```

---

## Task 6: Docs (README + design spec)

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-06-13-sloop-design.md`

- [ ] **Step 6.1: Update the design spec §6 terminology**

In `docs/superpowers/specs/2026-06-13-sloop-design.md`, in section 6 ("Roles, templates & model routing") and §4.2's workspace layout block, rename the concept: section heading → "Roles, workflows & model routing"; `.sloop/templates/` → `.sloop/workflows/`; "process template(s)" → "workflow(s)"; "stages" → "steps" where it denotes a workflow's steps; the `template` loop field → `workflow`. Leave historical wording in other dated docs untouched (they are a record).

Run after editing: `grep -n 'template\|stages' docs/superpowers/specs/2026-06-13-sloop-design.md`
Expected: no remaining references to the old concept in §4.2/§6 (incidental prose elsewhere is acceptable).

- [ ] **Step 6.2: Update README conventions**

In `README.md`, update any mention of `.sloop/templates`, "templates", or the `template` frontmatter field to `workflows` / `workflow`. Check the workspace-layout and conventions sections.

Run: `grep -n 'template' README.md`
Expected: no references to the old concept (or only clearly-incidental prose).

- [ ] **Step 6.3: Commit**

```bash
git add README.md docs/superpowers/specs/2026-06-13-sloop-design.md
git commit -m "docs: rename templates -> workflows in README and design spec"
```

---

## Task 7: Final verification & straggler sweep

- [ ] **Step 7.1: Full typecheck + test**

Run: `npm run typecheck 2>&1 | tail -20 && npm test 2>&1 | tail -20`
Expected: no `template`/`workflow`/`stages`/`steps`-related errors; failures limited to the Step 0b `moveAdr` baseline (if still in flight).

- [ ] **Step 7.2: Self-databank honesty guard**

Run: `node scripts/verify-self-databank.mjs`
Expected: `0 mismatch(es)`.

- [ ] **Step 7.3: Straggler grep guard**

```bash
echo "--- code (should be empty) ---"
grep -rn 'TemplateDef\|listTemplates\|getTemplates\|TEMPLATES_DIR\|create-template\|/api/templates' src || echo "code clean"
echo "--- dirs (should be empty) ---"
git ls-files | grep '\.sloop/templates/' || echo "no template dirs tracked"
echo "--- frontmatter keys (should be empty) ---"
grep -rn '^template:' cascades fixtures/sample-workspace/cascades || echo "no stale template: keys"
grep -rn '^stages:' .sloop/workflows assets/init-template/.sloop/workflows fixtures/sample-workspace/.sloop/workflows || echo "no stale stages: keys"
```
Expected: every section prints its "clean"/"no …" message.

- [ ] **Step 7.4: Run the app smoke check (optional but recommended)**

Run: `SLOOP_WORKSPACE=$(pwd) npm run build` (or `npm run start` briefly)
Expected: build succeeds (modulo the Step 0b baseline); the workspace's `.sloop/workflows/` loads.

---

## Self-review notes (for the executor)

- **Spec coverage:** Task 1 ⇒ spec §2.1, §4.1; Task 2–3 ⇒ §3, §4.2; Task 4 ⇒ §4.3 (data); Task 5 ⇒ §4.3 (ADR-011); Task 6 ⇒ §4.3 (docs); Task 7 ⇒ §6 verification. Out-of-scope items (§5: no `.sloop/steps/` library; no runtime change) are intentionally absent.
- **Type consistency:** `WorkflowDef.steps`, `LoopFrontmatter.workflow`, `CascadeSummary.workflow`, `listWorkflows`, `getWorkflows`, `GetWorkflowsResponse`, `WORKFLOWS_DIR`, `workflowId`, `AssistantAction` `'create-workflow'`, `LibKind` `'workflows'` — used identically everywhere they appear.
- **Concurrency:** if Task 2/3 collide with the live `moveAdr` edits to `types.ts`/`real.ts`/`filesService.ts`, stop and surface the conflict (per §6) rather than overwriting the other WP's work.
```
