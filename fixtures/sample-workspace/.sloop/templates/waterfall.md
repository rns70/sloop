---
id: waterfall
name: Waterfall
stages:
  - { name: requirements, role: architect, model: opus }
  - { name: design,       role: architect, model: opus }
  - { name: implement,    role: engineer,  model: sonnet }
  - { name: verify,       role: qa,         model: sonnet, gate: true }
  - { name: deploy,       role: engineer,  model: haiku }
---

# Waterfall

Sequential stages, each gated on the previous: **requirements → design → implement →
verify → deploy**. A stage's loops do not start until the prior stage's artifact is
frozen and verified.

The value here is **gating discipline**: a frozen, reviewed artifact at each handoff
reduces error propagation between phases. The cost is **latency** — pure sequential
phases serialize work that agents could otherwise interleave. Choose waterfall only when
requirements are genuinely frozen and the phases have hard linear dependencies (e.g. a
schema migration that must land before the code depending on it); prefer `spec-driven`
otherwise.

The **verify** stage is the gate: QA confirms each locked criterion on exit 0 before
deploy begins.
