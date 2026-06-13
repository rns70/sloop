---
loop:
  id: auth-session-plan
  type: implementation-plan
  status: passed
  autoApply: true
  stages: []
evals:
  - Implementation includes deterministic tests.
---
# Auth Session Plan

Implement session enforcement with a deterministic policy:
- `created_at` + absolute expiry (`12h`) and inactivity expiry (`20m`).
- Update `last_seen_at` on each authenticated request and recalculate remaining window.
- Reject sessions that exceed either limit, then invalidate all session data.

## Deterministic tests
- **Absolute expiry test**: with a fixed clock seed, create a session with `created_at = T0` and assert it remains valid at `T0+12h-1s` and invalid at `T0+12h+1s`.
- **Inactivity expiry test**: with fixed time steps, verify activity at `T0+19m` is accepted and activity at `T0+21m` is rejected.
- **Cleanup test**: using a deterministic session id fixture, ensure invalid/expired sessions are removed and cannot be refreshed.
