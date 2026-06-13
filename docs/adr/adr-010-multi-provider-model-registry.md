---
id: adr-010
title: Multi-provider model registry and routing
acceptanceCriteria:
  - id: ac-1
    text: "resolveModel turns a model alias into a concrete provider+id (with baseUrl/apiKey) using the registry and env."
    verify: "npm test -- resolveModel"
    passed: true
  - id: ac-2
    text: "The registry defines both an anthropic and a nebius (OpenAI-compatible) provider."
    verify: "grep -q 'nebius' .sloop/config.md"
    passed: true
---

# ADR-010 — Multi-provider model registry and routing

## Context
sloop should not be Anthropic-only, and routing rules should be versioned and diffable
like every other piece of state — not buried in code.

## Decision
A **model registry** in `.sloop/config.md` frontmatter maps aliases to `{ provider, id }`
and declares providers. Two ship: `anthropic` (Claude, built into Pi) and `nebius`
(Nebius AI Studio's OpenAI-compatible API, hosting NVIDIA Nemotron). The pure
`resolveModel(alias, registry, env)` helper resolves an alias to a concrete
`{ provider, id, baseUrl?, apiKey }`. Routing principle: **expensive reasoning at the
root, cheap doing at the leaves**, with resolution order per-loop override → template
stage → role default → global default.

## Consequences
- A new provider/model is added in exactly one place — the registry.
- The architect can plan on one model and execute leaves on another, any mix.
- Resolution stays pure (no env reads inside `src/shared`) per
  [[adr-013-frozen-shared-contracts]].
