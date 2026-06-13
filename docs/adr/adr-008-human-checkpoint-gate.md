---
id: adr-008
title: A human checkpoint gates execution
acceptanceCriteria:
  - id: ac-1
    text: "A proposed cascade reaches an awaiting_approval state before any loop executes."
    verify: "grep -rq 'awaiting_approval' src/server"
    passed: true
  - id: ac-2
    text: "The cascade engine does not execute inner loops until the tree is approved."
    verify: "npm test -- cascadeEngine"
    passed: true
---

# ADR-008 — A human checkpoint gates execution

## Context
sloop spawns external agents that modify code and run tools. Letting a planner fan out
and execute with no human review is unsafe and untrustworthy, especially for a system
whose whole point is matching code to *intended* requirements.

## Decision
After the architect proposes a tree, it is presented at a **checkpoint** for the human:
approve all · edit · skip. Inner loops do not run until approved; a cascade sits in
`awaiting_approval` until then. This is a confirmed requirement, not optional.

## Consequences
- The human stays in control of what runs against their code.
- The checkpoint is the primary MVP security mitigation (alongside git reviewability).
- Approval is a state transition, hence a commit ([[adr-005-git-is-the-substrate]]).
