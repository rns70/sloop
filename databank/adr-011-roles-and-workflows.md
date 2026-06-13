---
id: adr-011
title: Roles and workflows are orthogonal markdown
acceptanceCriteria:
  - id: ac-1
    text: "Roles and workflows ship as editable markdown files under .sloop/."
    verify: "test -d .sloop/roles && test -d .sloop/workflows"
    passed: true
  - id: ac-2
    text: "The architect instantiates a loop tree following the selected workflow."
    verify: "npm test -- architect"
    passed: true
---

# ADR-011 — Roles and workflows are orthogonal markdown

## Context
Two different concerns are easy to conflate: *who* does the work and *what shape* the
work tree takes. Baking either into code would make personas and methodologies
un-versioned and un-editable by users.

## Decision
**Roles** (`.sloop/roles/*.md`) define *who* — each is a markdown file whose frontmatter
sets defaults (`defaultModel`, `color`) and whose body is the brief the agent receives
(Architect, Engineer, QA, Security, …; user-definable). **Workflows**
(`.sloop/workflows/*.md`) define *the shape of the tree* — a development methodology as an
ordered list of **steps**, each staffed by a role + model (`spec-driven` default, plus
`waterfall`, `tdd`, `agile`). They are orthogonal: a workflow references roles to staff
its steps. Both are plain markdown, so they are versioned, diffable, and editable in the
same shared editor as everything else. Activities like migration and defect repair are
steps within a workflow (folded into `waterfall` and `tdd`), not workflows of their own.

## Consequences
- Users invent methodologies by copying and editing a workflow — no new runtime code.
- Routing, personas, and process all live as reviewable files under git.
- The architect ([[adr-009-pi-execution-engine]]) reads the chosen workflow and stamps
  out child loops to match.
