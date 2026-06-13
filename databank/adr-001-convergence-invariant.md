---
id: adr-001
title: The convergence invariant
acceptanceCriteria:
  - id: ac-1
    text: "A loop's `done` status is derived, not stored: a loop is done iff all its child loops are done and its own acceptance criteria pass."
    verify: "npm test -- convergence"
    passed: true
  - id: ac-2
    text: "Completion bubbles up the tree — the cascade engine re-evaluates a parent's status from its children and blocks a subtree when a leaf fails."
    verify: "npm test -- cascadeEngine"
    passed: true
---

# ADR-001 — The convergence invariant

## Context
sloop's entire value proposition is a single bit: *is the codebase in sync with the
databank?* For that bit to be trustworthy it cannot be self-reported — it must be a
mechanical consequence of the loop tree, not a status someone typed.

## Decision
A loop is **done** if and only if (1) all of its child loops are done, and (2) its own
acceptance criteria pass. Recursion bottoms out at leaves small enough to verify
directly, so completion bubbles up the tree:

```
root loop done ⟺ every descendant done ⟺ every changed criterion satisfied ⟺ code matches databank
```

Loop status is **derived**, never merely stored. An inner loop cannot be "done" while a
child is failing or running; a failed leaf propagates upward as a `blocked` root that
shows exactly where reconciliation stalled.

## Consequences
- Tree depth is emergent — however deep it takes to reach verifiable criteria.
- "Are we in sync?" collapses to reading the root loop's derived status.
- This is the one novel idea sloop must get right; everything else serves it.
