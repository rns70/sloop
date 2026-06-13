# Code Stage Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build controller-doc-backed code stages that can create code outputs and loop on eval until passing.

**Architecture:** Extend the existing Markdown/frontmatter model instead of adding a database. Materialize missing code controller docs before Pi runs, include controller docs and allowed output paths in the Pi prompt, capture Markdown and code file changes from the worktree, and run deterministic command eval after each Pi attempt.

**Tech Stack:** TypeScript, Vite, Express, Vitest, gray-matter, Node child processes, Git worktrees.

---

### Task 1: Stage Schema And Parser

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `server/lib/markdown.ts`
- Test: `tests/markdown.test.ts`

- [ ] Add `kind`, `outputs`, `evals`, and `commands` to stage parsing.
- [ ] Default omitted `doc` for `kind: code` to `loops/build/<stage-id>.md`.
- [ ] Parse top-level controller `outputs` and `commands` on loop docs.
- [ ] Verify with `npm test -- tests/markdown.test.ts`.

### Task 2: Code Controller Materialization

**Files:**
- Create: `server/lib/stageControllers.ts`
- Test: `tests/pi-run.test.ts`

- [ ] Create missing controller docs for code stages before Pi runtime context is built.
- [ ] Preserve parent intent by linking the controller body back to its parent doc.
- [ ] Do not overwrite existing controller docs.
- [ ] Verify with `npm test -- tests/pi-run.test.ts`.

### Task 3: Pi Runtime Code Outputs And Retry

**Files:**
- Modify: `server/lib/piRuntime.ts`
- Modify: `server/lib/evaluation.ts`
- Test: `tests/pi-run.test.ts`

- [ ] Include affected docs, outputs, commands, and inherited criteria in Pi prompts.
- [ ] Capture changed Markdown and code files, including newly created output files.
- [ ] Reject changed files outside affected docs and allowed output patterns.
- [ ] Run command eval inside the worktree.
- [ ] Retry Pi with eval evidence until pass or max attempts.
- [ ] Verify with focused runtime tests.

### Task 4: Server Wiring And UI Display

**Files:**
- Modify: `server/index.ts`
- Modify: `src/App.tsx`
- Test: existing server/UI tests

- [ ] Ensure server cascades use the enhanced Pi runtime.
- [ ] Show stage kind and code outputs in the footer without changing the document-first layout.
- [ ] Verify with `npm test`.

### Task 5: Full Verification

**Files:**
- No new files expected.

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Review `git diff --stat` and confirm only intended files changed.
