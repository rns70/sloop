---
id: waterfall
name: Waterfall
steps:
  - { name: requirements, role: architect, model: opus }
  - { name: design,       role: architect, model: opus }
  - { name: implement,    role: engineer,  model: sonnet }
  - { name: verify,       role: qa,         model: sonnet, gate: true }
  - { name: deploy,       role: engineer,  model: haiku }
---

# Waterfall

Sequential steps, each gated on the previous: **requirements → design → implement →
verify → deploy**. A step's loops do not start until the prior step's artifact is frozen
and verified.

The value here is **gating discipline**: a frozen, reviewed artifact at each handoff
reduces error propagation between phases. The cost is **latency** — pure sequential
phases serialize work that agents could otherwise interleave. Choose waterfall only when
requirements are genuinely frozen and the phases have hard linear dependencies; prefer
`spec-driven` otherwise.

The **verify** step is the gate: QA confirms each locked criterion on exit 0 before
deploy begins.

## Behavior-preserving migrations

A schema migration or large refactor is the canonical waterfall case — it has hard linear
dependencies and must not change behavior. Run it as: **survey** (an explorer maps every
call site and file the change touches, read-only, and returns the file partition) →
**plan a codemod** (prefer a deterministic codemod/recipe over free-form edits;
mechanical changes should be mechanical, which constrains hallucination) → **apply**
(engineer leaves apply the change, one disjoint file set each) → **verify**. The gate's
oracle is the **existing** test suite (`locked: true`): behavior is preserved iff every
test that passed before still passes.
