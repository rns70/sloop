---
id: adr-013
title: Frozen shared contracts kept pure
acceptanceCriteria:
  - id: ac-1
    text: "src/shared contains no Date.now() — shared logic stays pure so timestamps are passed in."
    verify: "! grep -rq 'Date.now()' src/shared"
    passed: true
  - id: ac-2
    text: "The shared contracts and everything importing them typecheck."
    verify: "npm run typecheck"
    passed: false
---

# ADR-013 — Frozen shared contracts kept pure

## Context
sloop was built by parallel work-package agents sharing one repo. Without a single frozen
contract surface, each agent would redefine types and the pieces would not fit together.
Impure shared logic (reading the clock or env) would also make the orchestrator
non-deterministic and hard to test.

## Decision
`src/shared` holds the **canonical, frozen contracts** — every work package imports from
here and never redefines them; it is frozen after the foundation merges. Shared logic is
**pure**: no `Date.now()` or env reads inside `src/shared` (timestamps are passed in).
Each work package owns its file paths exclusively and does not edit outside its set.

## Consequences
- Contracts ripple correctly: a fix is made once, in one place, behind `npm run typecheck`.
- Pure shared logic is deterministic and unit-testable (e.g. `resolveModel`).
- This underpins the document-shape guarantee in [[adr-006-frontmatter-contract]].
