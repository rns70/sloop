---
id: adr-016
title: One shared markdown editor with an authoring assistant
acceptanceCriteria:
  - id: ac-1
    text: "BlockNote is the shared markdown editor dependency."
    verify: "grep -q '@blocknote/core' package.json"
    passed: true
  - id: ac-2
    text: "An authoring assistant proposes databank edits via the assistant service, surfaced as diffs."
    verify: "npm test -- assistant"
    passed: true
---

# ADR-016 — One shared markdown editor with an authoring assistant

## Context
ADRs, role files, and template files are all just markdown. Building a separate editor for
each surface would duplicate work and diverge. And authoring the databank itself — the
front half of the loop — deserves AI help, but silent AI writes to requirements would be
untrustworthy.

## Decision
**One shared editor — BlockNote** — is reused for every editable file (ADRs, roles,
templates), block-based with markdown import/export and an inline-diff mode. An
**authoring assistant** (Cursor-style, powered by `pi-ai`) helps write the databank, with
proposed changes always surfaced as **inline diffs the user accepts or rejects — never
silent writes**.

## Consequences
- Every editable surface behaves identically; one editor to maintain.
- AI-authored requirements are reviewable and revertible like any git change.
- This closes the loop: author requirements with AI, then cascade to make code match.
