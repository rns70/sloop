---
id: adr-003
title: Bounded loop-tree depth for safety
acceptanceCriteria:
  - id: ac-1
    text: "The cascade engine refuses to fan out a proposed tree deeper than the configured cap."
    verify: "npm test -- cascadeEngine"
    passed: true
  - id: ac-2
    text: "The depth cap is sourced from the workspace `.sloop/config.md` `depthCap` field."
    verify: "grep -q 'depthCap' src/server/cascade/cascadeEngine.ts"
    passed: false
---

# ADR-003 — Bounded loop-tree depth for safety

## Context
The convergence invariant makes tree depth *emergent* — conceptually unbounded. Spawning
agents that spawn agents is a cost and safety hazard, and unacceptable for a live demo
that must not run away.

## Decision
A hard, configurable depth/loop cap bounds the tree. The architect proposes a shallow
tree (architect → leaves, optionally one inner layer) and the engine rejects any tree
that exceeds the cap before execution. The cap lives in `.sloop/config.md` as `depthCap`
so it is versioned and diffable like everything else.

## Consequences
- Live demos and self-cascades cannot recurse indefinitely.
- **Known drift (ac-2 red):** the engine currently reads the cap from a
  `SLOOP_MAX_DEPTH` env var rather than the `depthCap` field declared in
  `.sloop/config.md`. The config value is unconsumed. Reconciling this — wiring the
  config field into `cascadeEngine` — is the worklist item this ADR surfaces. This is the
  databank doing its job: a declared requirement that the code does not yet satisfy.
