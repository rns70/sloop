---
id: rotate-refresh-tokens
kind: leaf
role: engineer
model: haiku
status: planned
delta: change
parent: _architect
children: []
sourceAdr: adr-007
workflow: spec-driven
executor: pi
acceptanceCriteria:
  - id: ac-1
    text: "Refresh tokens rotate on every use and expire within ≤15 minutes."
    verify: "npm test -- rotation"
    passed: false
---

# Leaf — rotate-refresh-tokens

## Brief
Implement refresh-token rotation in the token service: issue a fresh token on every
refresh, invalidate the prior one atomically, and cap lifetime at 15 minutes.

## Acceptance
`ac-1` passes when `npm test -- rotation` exits 0. Done iff that criterion passes.
