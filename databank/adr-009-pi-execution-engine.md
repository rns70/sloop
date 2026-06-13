---
id: adr-009
title: Pi is the execution engine
acceptanceCriteria:
  - id: ac-1
    text: "All model and agent execution goes through Pi packages; no direct Anthropic or OpenAI SDK is a dependency."
    verify: "grep -q '@earendil-works/pi-ai' package.json && ! grep -Eq '\"(openai|@anthropic-ai/sdk)\"' package.json"
    passed: true
  - id: ac-2
    text: "A single executor wraps a Pi coding agent to run a leaf against the target repo and then verify its criteria."
    verify: "npm test -- piExecutor"
    passed: true
---

# ADR-009 — Pi is the execution engine

## Context
sloop is a *conductor*, not its own coding agent. Hand-rolling an agent runtime and a
client per provider would be a large, brittle surface area orthogonal to sloop's novel
idea.

## Decision
sloop embeds **Pi** (`earendil-works/pi`, MIT) for all model calls and agent execution.
`@earendil-works/pi-ai` is the unified multi-provider LLM layer; `pi-agent-core` and
`pi-coding-agent` provide the agent runtime. A single **Executor** wraps a Pi coding
agent: given a leaf, it runs against the target repo on the leaf's resolved model, streams
output, then runs the criteria `verify` step. No Claude Code subprocess, no bespoke
OpenAI loop.

## Consequences
- Provider support (including Nebius/Nemotron) comes from Pi, not sloop code.
- sloop owns decomposition, gating, persistence, and convergence — not the agent loop.
- Model selection per loop is resolved via [[adr-010-multi-provider-model-registry]].
