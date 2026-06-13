---
loop:
  id: prd-auth
  type: prd
  status: passing
  autoApply: true
  stages:
    - id: auth-architecture-a
      title: Auth architecture A
      doc: sample-workspace/architecture/auth-a.md
      status: evaluating
      agent: pi
    - id: auth-architecture-b
      title: Auth architecture B
      doc: sample-workspace/architecture/auth-b.md
      status: archived
      agent: pi
    - id: auth-session-plan
      title: Auth session plan
      doc: sample-workspace/plans/auth-session.md
      status: passed
      agent: pi
evals:
  - Every authentication requirement has a downstream architecture decision.
  - Every session behavior has an implementation plan with deterministic tests.
---
# Authentication Requirements

Users can sign in, maintain a session, and recover access without creating support burden or weakening account security.

## Requirement: Sessions

Sessions must be long enough for normal product use and short enough to limit stale access risk.
