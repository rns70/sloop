---
id: _architect
kind: architect
role: architect
model: opus
status: awaiting_approval
delta: change
children:
  - rotate-refresh-tokens
  - invalidate-on-reuse
  - review-token-security
sourceAdr: adr-007
template: spec-driven
---
# Architecture loop — token-rotation-sync

## Diff read
ADR-007 changed: `ac-1` (rotation, ≤15m) is unchanged; **`ac-2` (reuse detection +
session revocation) is new**. One `change` delta in scope.

## Proposed tree (spec-driven: plan → implement → verify)
1. **rotate-refresh-tokens** *(engineer / haiku)* — satisfy `ac-1`: rotation on every
   use, ≤15m lifetime.
2. **invalidate-on-reuse** *(engineer / nemotron)* — satisfy `ac-2`: reject reused
   tokens, revoke the session family.
3. **review-token-security** *(security / sonnet)* — confirm no reuse window or token
   leakage was introduced.

This loop is **done** only when all three children are done and their criteria pass —
at which point the codebase matches ADR-007. Awaiting approval before fan-out.
