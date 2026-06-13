---
id: adr-014
title: CLI with idempotent init scaffold
acceptanceCriteria:
  - id: ac-1
    text: "The CLI argv parser is implemented and tested."
    verify: "npm test -- args"
    passed: true
  - id: ac-2
    text: "init scaffolds a workspace idempotently — re-running never clobbers existing files."
    verify: "npm test -- scaffold"
    passed: true
---

# ADR-014 — CLI with idempotent init scaffold

## Context
To use sloop on a project, that project needs to become a workspace: a `databank/` and a
`.sloop/` with config, roles, and templates. Hand-creating these is error-prone, and a
scaffold that overwrites edited files on re-run would be dangerous.

## Decision
A CLI provides `init`, which scaffolds a workspace from a bundled seed template
(`assets/init-template`). The scaffold is **idempotent**: re-running it adds only what is
missing and never clobbers files the user has edited. The argv parser and scaffold are
unit-tested.

## Consequences
- Onboarding a project is one command.
- Safe to re-run after upgrades to pull in new seed files without losing edits.
- This very self-workspace's `.sloop/` was seeded from the same init template.
