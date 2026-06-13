---
id: agile
name: Agile
steps:
  - { name: plan,      role: architect, model: sonnet }
  - { name: implement, role: engineer,  model: haiku }
  - { name: verify,    role: qa,         model: sonnet, gate: true }
---

# Agile

Iterative, story-sized delivery — the same **plan → implement → verify** shape as
spec-driven, but deliberately lightweight and looped per story rather than run once over a
frozen spec.

1. **plan** — the architect slices the delta into the smallest shippable stories and
   stamps out one leaf per story, each with a locked, machine-checkable acceptance
   criterion. Planning runs on a cheaper model than waterfall because each slice is small
   and low-risk; escalate a leaf's model only when a story is open-ended.
2. **implement** — an engineer leaf makes the smallest change that satisfies its story's
   locked criterion.
3. **verify** *(gate)* — each story's `verify` command runs; QA confirms on exit 0.

Prefer agile when the work is naturally incremental and requirements may evolve between
slices. Each story converges independently, and completion bubbles up: the root is done
iff every story leaf is done and its locked criterion passes.
