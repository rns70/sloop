---
id: adr-005
title: Git is the substrate
acceptanceCriteria:
  - id: ac-1
    text: "The workspace uses simple-git for all git operations."
    verify: "grep -q '\"simple-git\"' package.json"
    passed: true
  - id: ac-2
    text: "The git service can diff the databank against the last accepted commit and commit workspace changes."
    verify: "npm test -- gitService"
    passed: true
---

# ADR-005 — Git is the substrate

## Context
Because markdown files *are* the state ([[adr-004-markdown-is-the-system]]), the history
of that state and the mechanism for detecting change should not be reinvented. Git
already provides content-addressed history, diffing, branching, and rollback.

## Decision
Git is the change-tracking and audit layer. State transitions are commits; a cascade's
git log is its audit trail. The diff that triggers a cascade is the git diff of the
`databank/` against the last accepted commit. Rollback is `git revert` of a cascade's
commits. sloop uses `simple-git` for all git access.

## Consequences
- The audit trail is free and standard — no bespoke event log.
- Parallel leaf agents share one checkout, so commits must be made carefully (via
  plumbing, not branch checkout) to avoid HEAD/branch collisions.
- Cascade scope is git-based: see [[adr-007-cascade-is-a-databank-diff]].
