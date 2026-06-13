---
id: prd
title: Product Requirements
status: idle
workflow: spec-driven
children:
  - loops/architecture/architecture.md
---

# Product Requirements

Describe the product, its constraints, and acceptance criteria. This is the root of
your loop hierarchy: each loop links to its children by **relative path** in the
`children` frontmatter list, forming the tree sloop plans and executes top-down.

sloop diffs `loops/` against git HEAD, plans work for what changed, and has a coding
agent implement it until every criterion's `verify` command exits 0.

## Acceptance criteria

- [ ] Requirements are specific enough for downstream design and implementation.
