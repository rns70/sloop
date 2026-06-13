---
id: adr-012
title: Device trust on sign-in
---
# ADR-012 — Device trust on sign-in

## Context
Password-only sign-in from an unknown device is a common account-takeover vector.
We want to bind sessions to known devices and step up auth for new ones.

## Decision
- Fingerprint devices on sign-in and remember trusted devices per user.
- Require a second factor when the device is unrecognized, before issuing a session.

## Consequences
- First sign-in on any device incurs a step-up challenge.
- Device fingerprints are stored hashed, never raw.

## Acceptance criteria

- [ ] **ac-1** An unrecognized device must pass a second factor before a session is issued. — verify: `npm test -- device-trust`
