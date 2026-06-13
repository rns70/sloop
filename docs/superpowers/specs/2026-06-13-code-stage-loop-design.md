# Code Stage Loop Design

Date: 2026-06-13

## Decision

Sloop keeps Markdown as the source of truth for every executable loop. A stage that produces code always has a Markdown controller doc. Code files are outputs of that controller doc, never the identity of the stage itself.

Parent loop docs own intent: product requirements, design constraints, architecture decisions, acceptance criteria, and the child stages that should exist. Code controller docs own runnable execution contracts: allowed output paths, stage-specific eval commands, implementation notes, current failure evidence, and retry history.

## Stage Shape

Stages support a `kind` field:

```yaml
loop:
  stages:
    - id: build-auth-session
      kind: code
      title: Build auth session
      outputs:
        - src/auth/**
        - tests/auth/**
      eval:
        commands:
          - npm test -- auth
```

For ergonomics, `doc` is optional on `kind: code` stages. If omitted, Sloop materializes a controller doc at `loops/build/<stage-id>.md` before running the cascade.

## Controller Docs

A materialized controller doc is a normal loop doc:

```yaml
---
loop:
  id: build-auth-session
  type: code
  status: idle
  autoApply: true
  stages: []
outputs:
  - src/auth/**
  - tests/auth/**
commands:
  - npm test -- auth
evals: []
---
# Build auth session

Parent: loops/PRD.md
```

Controller docs may be edited by users or agents. After creation, they are durable workspace files and participate in normal diff, history, pause/resume, and cascade behavior.

## Frontmatter UI

Frontmatter is a first-class part of the document surface. The app should render common loop metadata as actual UI controls above the Markdown body instead of exposing raw YAML in the editor.

The initial metadata surface covers loop id, loop type, status, auto-apply, child stages, eval criteria, allowed code outputs, and deterministic commands. Editing loop id, type, status, and auto-apply saves through the existing document save path while preserving sibling and unknown frontmatter fields. Stage, eval, output, and command metadata render as structured document-native lists so users can inspect executable loop contracts without leaving the paper-like editor.

## Loop Execution

Runs execute in an isolated Git worktree. Before invoking Pi, Sloop materializes missing code controller docs and computes affected downstream docs from stage links.

Pi receives the source doc, affected controller docs, inherited textual eval criteria, allowed output paths, and deterministic commands. For code controller docs, Pi may edit the controller doc and its allowed output paths.

After each Pi attempt, Sloop captures Markdown and code changes, rejects changes outside the affected docs and allowed outputs, and runs deterministic eval commands in the worktree. If eval fails, Sloop feeds the failure evidence back to Pi and retries in the same worktree/session. The loop stops when eval passes, Pi fails to run, or the max attempt count is reached.

Only a passing run is applied back to the main workspace. Failed runs are archived with their worktree metadata and eval evidence.

## Initial Scope

The first implementation supports:

- `kind: doc` and `kind: code` stages.
- Auto-materialized code controller docs.
- Code output path metadata.
- Worktree diff capture for Markdown and code files.
- Command-based eval inside the Pi loop.
- Retry-until-pass with failure evidence.

The first implementation does not include visual stage editing, branch merge commits, semantic impact analysis, selected winners for alternatives, or long-running pause/resume of an already executing Pi subprocess.
