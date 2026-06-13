---
id: adr-004
title: Markdown is the system
acceptanceCriteria:
  - id: ac-1
    text: "There is no database dependency; the markdown files on disk are the only persistence."
    verify: "! grep -Eq '\"(pg|mysql|sqlite3|better-sqlite3|mongodb|prisma|typeorm|knex|sequelize|redis)\"' package.json"
    passed: true
  - id: ac-2
    text: "Loop and cascade state is read from and written to markdown files in the workspace."
    verify: "npm test -- filesService"
    passed: true
---

# ADR-004 — Markdown is the system

## Context
sloop needs persistence for loops, cascades, ADRs, roles, and templates. A database
would create hidden state the user cannot see, edit, or diff — and would split the source
of truth between rows and files.

## Decision
Markdown files are **both the persistence layer and the change-tracking layer.** There is
no separate database. Each loop and cascade is a markdown file with YAML frontmatter for
structured properties and a body for human-readable content. The UI is a view over these
files; editing in the UI writes markdown, and editing markdown externally is reflected in
the UI.

## Consequences
- Nothing is hidden — every piece of state is a file the user can open and edit.
- Persistence is trivially portable, greppable, and version-controllable.
- See [[adr-005-git-is-the-substrate]] for how history is tracked on top of these files.
