---
id: adr-015
title: Offline eval harness for the orchestrator
acceptanceCriteria:
  - id: ac-1
    text: "The eval harness computes cost, metrics, and reports over tasks, with passing unit tests."
    verify: "npm test -- eval"
    passed: true
---

# ADR-015 — Offline eval harness for the orchestrator

## Context
sloop's quality is its convergence behavior — does a cascade actually drive a repo to
green, at reasonable cost and tree size? That cannot be judged by eyeballing a demo; it
needs repeatable measurement.

## Decision
sloop ships an **offline eval harness**: tasks run against sample repos, with pure modules
for cost (by model), metrics (tree size/depth, criteria counts, latency), and report
generation. Results are regenerable per run; committed `summary.md`/`meta.json` capture a
baseline. The harness is unit-tested and runs without live model calls in dry-run mode.

## Consequences
- Regressions in the orchestrator are measurable, not anecdotal.
- Cost and tree-shape are tracked as first-class outputs.
- A SWE-bench subset hook exists for benchmarking against external tasks.
