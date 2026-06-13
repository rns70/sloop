---
id: adr-006
title: Frontmatter keys mirror the TypeScript contracts
acceptanceCriteria:
  - id: ac-1
    text: "Frontmatter parses to and serializes from the shared typed interfaces and round-trips losslessly."
    verify: "npm test -- frontmatter"
    passed: true
  - id: ac-2
    text: "The whole workspace contract typechecks with no errors."
    verify: "npm run typecheck"
    passed: false
---

# ADR-006 — Frontmatter keys mirror the TypeScript contracts

## Context
Loops, cascades, ADRs, roles, templates, and config are all markdown with frontmatter.
If frontmatter keys drifted from the TypeScript interfaces, every read would need a
fragile remapping layer and parse errors would surface far from their cause.

## Decision
All workspace frontmatter keys are **camelCase and match the shared TS interfaces
exactly** (`acceptanceCriteria`, `sourceAdr`, `defaultModel`, …). `gray-matter` parses
frontmatter straight into the typed shapes with no key remapping. The shared interfaces
in `src/shared/types.ts` are the single source of truth for document shape.

## Consequences
- Reading a document is `gray-matter` + a type assertion — no translation layer.
- A schema change is one edit to the shared interface, enforced by `npm run typecheck`.
- Depends on the frozen shared contracts in [[adr-013-frozen-shared-contracts]].
