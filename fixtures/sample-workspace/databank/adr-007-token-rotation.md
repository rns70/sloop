---
id: adr-007
title: Refresh-token rotation
---
# ADR-007 — Refresh-token rotation

## Context
Long-lived refresh tokens are a standing risk: a leaked token grants an attacker
indefinite access. We want short rotation windows and reuse detection so a stolen
token is both short-lived and self-revealing.

## Decision
- Issue a new refresh token on every refresh; invalidate the previous one atomically.
- Cap refresh-token lifetime at 15 minutes.
- Detect reuse of an already-rotated token and revoke the entire session family.

## Consequences
- Clients must handle rotation transparently on 401.
- The session store must track the active token per family for reuse detection.

> Acceptance criteria carry stable ids (`ac-1`, `ac-2`) so a databank diff can scope
> exactly which requirement changed; each has a `verify` command (exit 0 = passed).

## Acceptance criteria

- [ ] **ac-1** Refresh tokens rotate on every use and expire within ≤15 minutes. — verify: `npm test -- rotation`
- [ ] **ac-2** A refresh token presented twice (reuse) is rejected and the session is revoked. — verify: `npm test -- reuse-detection`
