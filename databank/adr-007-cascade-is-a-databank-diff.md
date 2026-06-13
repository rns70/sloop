---
id: adr-007
title: A cascade is a databank diff turned into a tree
acceptanceCriteria:
  - id: ac-1
    text: "The cascade engine diffs the databank into add/change/delete deltas and builds a loop tree from them."
    verify: "npm test -- cascadeEngine"
    passed: true
---

# ADR-007 — A cascade is a databank diff turned into a tree

## Context
The user expresses desired state by editing the databank. sloop must detect what changed
and turn it into work — without the user manually describing the change.

## Decision
A **cascade** is triggered by a change to the databank. sloop diffs the databank working
tree against the last accepted commit ([[adr-005-git-is-the-substrate]]) and classifies
each change as a `delta` of type `add`, `change`, or `delete`. The architecture loop
reads the deltas and decomposes them into a tree of role-typed child loops with
acceptance criteria.

## Consequences
- Work is scoped exactly to what changed — no full rebuilds.
- Deletes are first-class deltas, not just adds and edits.
- The proposed tree is gated by a human before it runs:
  [[adr-008-human-checkpoint-gate]].
