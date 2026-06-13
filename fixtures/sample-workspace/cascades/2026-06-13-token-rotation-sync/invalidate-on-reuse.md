---
id: invalidate-on-reuse
kind: leaf
role: engineer
model: nemotron
status: planned
delta: change
parent: _architect
children: []
sourceAdr: adr-007
template: spec-driven
executor: pi
acceptanceCriteria:
  - id: ac-2
    text: "A refresh token presented twice (reuse) is rejected and the session is revoked."
    verify: "npm test -- reuse-detection"
    passed: false
---

# Leaf — invalidate-on-reuse

## Brief
Detect reuse of an already-rotated refresh token and revoke the entire session family.
Runs on the **nemotron** alias (Nebius / NVIDIA Nemotron) — demonstrating that leaves
can execute on a non-Anthropic provider, routed entirely through Pi.

## Acceptance
`ac-2` passes when `npm test -- reuse-detection` exits 0.
