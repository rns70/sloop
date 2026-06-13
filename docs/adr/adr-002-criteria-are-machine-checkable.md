---
id: adr-002
title: Acceptance criteria are machine-checkable
acceptanceCriteria:
  - id: ac-1
    text: "Acceptance criteria parse from and serialize back to markdown frontmatter with stable ids, text, a verify command, and a passed flag."
    verify: "npm test -- criteriaMarkdown"
    passed: true
  - id: ac-2
    text: "The executor runs each criterion's verify command and marks it passed only on exit 0."
    verify: "npm test -- piExecutor"
    passed: true
---

# ADR-002 — Acceptance criteria are machine-checkable

## Context
The convergence invariant ([[adr-001-convergence-invariant]]) is only *real* if a
criterion's truth is established mechanically. A criterion whose passing is a matter of
opinion cannot anchor a "the code matches the databank" guarantee.

## Decision
Every acceptance criterion carries a stable `id`, human `text`, and a concrete `verify`
shell command. A criterion passes **only** when its `verify` command exits 0, run in the
target repo's root. Criteria without a command cannot be proven done (QA-role
adjudication is a later phase). The criterion is the definition of done.

## Consequences
- Authors must write machine-checkable conditions, not vague intentions.
- A databank diff can scope exactly which criterion changed via its stable id.
- This databank dogfoods the rule: every criterion here has a real `verify` command.
