---
id: adr-012
title: Local TypeScript web app, no native shell
acceptanceCriteria:
  - id: ac-1
    text: "There are no Rust sources in the tree (no Tauri/native core)."
    verify: "! git ls-files '*.rs' | grep -q ."
    passed: true
  - id: ac-2
    text: "The app builds: typecheck plus a production Vite build succeed."
    verify: "npm run build"
    passed: false
---

# ADR-012 — Local TypeScript web app, no native shell

## Context
An agent-first IDE could be built as a native app (the originally-considered Tauri/Rust
route). For iteration speed and a single-language codebase, that ceremony is not worth it.

## Decision
sloop is a **local TypeScript web app**: Vite + React + Tailwind frontend, a thin Node
backend (Express + `ws`) for file I/O, git, running Pi agents, and streaming output. It
is local-first — operates on a workspace folder, runs on `localhost`, single-user, no
hosted service. All orchestration logic is TypeScript; there is no Rust core.

## Consequences
- One language, fast hot-reload iteration, trivial local setup (`npm run dev`).
- No native packaging or code-signing burden.
- The whole system stays scriptable and testable from Node, including this self-cascade.
