---
loop:
  id: auth-architecture-a
  type: architecture
  status: evaluating
  autoApply: true
  stages:
    - id: auth-session-plan
      title: Auth session plan
      doc: sample-workspace/plans/auth-session.md
      status: passed
      agent: pi
evals:
  - Architecture covers the session requirement.
---
# Auth Architecture A

This architecture defines session handling for the PRD session requirement:
- Issue server-side session tokens with an absolute maximum age of **12 hours**.
- Enforce an inactivity timeout of **20 minutes** with sliding refresh on authenticated activity.
- Persist `created_at`, `last_seen_at`, and `expires_at` so sessions are long enough for normal use while limiting stale access risk.
