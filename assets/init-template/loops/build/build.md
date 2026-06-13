---
id: build
title: Build
status: idle
workflow: spec-driven
outputs:
  - src/**
  - tests/**
children: []
---

# Build

Implement the plan until the acceptance criteria pass. This is a leaf loop: it has no
children and writes code within the `outputs` globs above.

## Acceptance criteria

- [ ] The build passes. — verify: `npm test`
