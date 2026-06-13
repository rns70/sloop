---
id: spec-driven
name: Spec-driven
stages:
  - { name: plan,      role: architect, model: opus }
  - { name: implement, role: engineer,  model: haiku }
  - { name: verify,    role: qa,         model: sonnet }
---

# Spec-driven (default)

The default methodology: **plan → implement → verify**.

1. **plan** — the architect reads the delta and the ADR's acceptance criteria and
   stamps out one implementation leaf per actionable unit, copying each criterion (with
   its stable id and `verify` command) onto the leaf.
2. **implement** — an engineer leaf makes the change for each unit.
3. **verify** — each criterion's `verify` command runs; QA confirms. A criterion passes
   only on exit 0.

Keep the tree shallow (architect → leaves, optionally one inner layer). Completion
bubbles up: the root is done iff every leaf is done and its criteria pass.
