---
id: adr-011
title: Roles and templates are orthogonal markdown
acceptanceCriteria:
  - id: ac-1
    text: "Roles and templates ship as editable markdown files under .sloop/."
    verify: "test -d .sloop/roles && test -d .sloop/templates"
    passed: true
  - id: ac-2
    text: "The architect instantiates a loop tree following the selected process template."
    verify: "npm test -- architect"
    passed: true
---

# ADR-011 — Roles and templates are orthogonal markdown

## Context
Two different concerns are easy to conflate: *who* does the work and *what shape* the
work tree takes. Baking either into code would make personas and methodologies
un-versioned and un-editable by users.

## Decision
**Roles** (`.sloop/roles/*.md`) define *who* — each is a markdown file whose frontmatter
sets defaults (`defaultModel`, `color`) and whose body is the brief the agent receives
(Architect, Engineer, QA, Security, …; user-definable). **Templates**
(`.sloop/templates/*.md`) define *the shape of the tree* — the stages and which role +
model staffs each (`spec-driven` default, plus `waterfall`, `tdd`, …). They are
orthogonal: a template references roles to staff its stages. Both are plain markdown, so
they are versioned, diffable, and editable in the same shared editor as everything else.

## Consequences
- Users invent methodologies by copying and editing a template — no new runtime code.
- Routing, personas, and process all live as reviewable files under git.
- The architect ([[adr-009-pi-execution-engine]]) reads the chosen template and stamps
  out child loops to match.
