---
id: waterfall
name: Waterfall
stages:
  - { name: requirements, role: architect, model: opus }
  - { name: design,       role: architect, model: opus }
  - { name: implement,    role: engineer,  model: sonnet }
  - { name: verify,       role: qa,         model: sonnet }
  - { name: deploy,       role: engineer,  model: haiku }
---

# Waterfall

Sequential stages, each gated on the previous: **requirements → design → implement →
verify → deploy**. A stage's loops do not start until the prior stage is done.

> Hackathon status: stub. The picker proves templates are pluggable; `spec-driven` is
> the polished path. Flesh out the sequential gating post-hackathon.
