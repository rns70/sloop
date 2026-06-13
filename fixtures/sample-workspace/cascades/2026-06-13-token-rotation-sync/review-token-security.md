---
id: review-token-security
kind: leaf
role: security
model: sonnet
status: planned
delta: change
parent: _architect
children: []
sourceAdr: adr-007
workflow: spec-driven
executor: pi
---
# Leaf — review-token-security

## Brief
Security review of the rotation + reuse changes: confirm there is no race window where
both the old and new refresh token are simultaneously valid, and that tokens are never
logged in plaintext.

## Acceptance
`ac-3` passes when `npm test -- token-security-audit` exits 0.

## Acceptance criteria

- [ ] **ac-3** No reuse window remains: a rotated token is unusable the instant its successor is issued. — verify: `npm test -- token-security-audit`
