---
id: migrate
name: Migrate
stages:
  - { name: survey,       role: explorer,  model: haiku }
  - { name: plan-codemod, role: architect, model: opus }
  - { name: apply,        role: engineer,  model: haiku }
  - { name: verify-green, role: qa,        model: sonnet, gate: true }
---

# Migrate

Behavior-preserving migration / large refactor: **survey → plan-codemod → apply →
verify-green**.

1. **survey** — the explorer maps every call site and file the migration touches,
   read-only, and returns the file partition.
2. **plan-codemod** — the architect turns the survey into per-file leaves. Prefer a
   deterministic codemod/recipe as a tool over free-form edits: mechanical changes should
   be mechanical, which constrains hallucination.
3. **apply** — engineer leaves apply the change, one disjoint file set each.
4. **verify-green** *(gate)* — the **existing** test suite is the oracle and must stay
   green (`locked: true`): behavior is preserved iff every test that passed before still
   passes.

Because the migration must not change behavior, the pre-existing suite — not a new test —
is the locked gate.
