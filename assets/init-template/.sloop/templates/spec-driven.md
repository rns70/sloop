---
id: spec-driven
name: Spec-driven
stages:
  - { name: plan,      role: architect, model: opus }
  - { name: implement, role: engineer,  model: haiku }
  - { name: verify,    role: qa,         model: sonnet, gate: true }
---

# Spec-driven (default)

The default methodology: **plan → implement → verify**.

1. **plan** — the architect reads the delta and the ADR's acceptance criteria and stamps
   out one implementation leaf per actionable unit. Write each criterion in **EARS form**
   (WHEN/IF/WHILE <trigger>, the system SHALL <response>) so it is unambiguous, and copy
   it onto the owning leaf with a stable id, a concrete `verify` command, and
   `locked: true`. Partition leaves by file — no two leaves edit the same file.
2. **implement** — an engineer leaf makes the smallest change that satisfies its locked
   criteria, without weakening them.
3. **verify** *(gate)* — each criterion's `verify` command runs; QA, a separate agent,
   confirms. A criterion passes only on exit 0.

Keep the tree shallow (architect → leaves, optionally one inner layer). Completion
bubbles up: the root is done iff every leaf is done and its locked criteria pass.
