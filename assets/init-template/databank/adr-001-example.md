---
id: adr-001
title: Example requirement (delete or edit me)
acceptanceCriteria:
  - id: ac-1
    text: "The build passes."
    verify: "npm run build"
    passed: false
---

# ADR-001 — Example requirement

This is a starter ADR. An ADR is a unit of requirement in your databank. sloop diffs
the `databank/` against git HEAD, plans work for what changed, and has a coding agent
implement it in this repo until every criterion's `verify` command exits 0.

## How to use it
1. Replace this file (or add new `adr-NNN-*.md` files) describing what you want built.
2. Give each acceptance criterion a stable `id`, a human `text`, and a concrete `verify`
   shell command that returns exit 0 only when the requirement is met.
3. Open the sloop UI, kick off a cascade, approve it, and watch it converge.

## Notes
- `verify` runs in this repo's root, so commands like `npm test -- <pattern>` work.
- Keep criteria specific and machine-checkable — they are the definition of done.
