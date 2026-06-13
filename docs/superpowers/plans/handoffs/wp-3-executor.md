# Handoff — WP-3: Executor (Pi agent + verify) (backend)

> **Stage 2 — parallel. Depends on WP-0 only. Fully independent of the other backend WPs.**

## Before you start
Read the spec (§4.4 execution engine, §3 the `verify` note) and the overview. Branch: `wp-3-executor`. Implement the `Executor` interface from `src/shared/services.ts`.

## Your goal
Given a leaf `LoopDoc`, run a **Pi agent** to do the work, stream its output, then run each acceptance criterion's `verify` command to decide pass/fail. **One executor**, built on Pi's `agent` package — it is provider-agnostic, so the same code runs Anthropic, Nebius/Nemotron, or any registered model. No Claude Code subprocess, no hand-rolled provider loop.

## You own
- `src/server/executor/` — `piExecutor.ts`, `verify.ts`, tests.
Do not touch anything else. Depend only on shared types + the shared `resolveModel` helper + Pi (`@earendil-works/pi-ai` and Pi's `agent` package).

## Tasks
1. `verify.ts`: `runVerify(command, cwd): Promise<boolean>` — spawn the command via `child_process`, resolve `true` iff exit code 0. Apply a timeout (env `SLOOP_VERIFY_TIMEOUT_MS`, default 120000) → treat timeout as fail. Pure-ish and unit-testable with trivial commands (`exit 0` vs `exit 1`).
2. `piExecutor.ts`: implement `Executor.run(loop, onOutput)`:
   - Build a brief from the loop body + its `acceptanceCriteria`.
   - Instantiate a Pi agent on the leaf's resolved model (`pi-ai` model selected from the registry; provider dispatch is Pi's job — Anthropic, Nebius/Nemotron, etc. all work the same). Read Pi's `agent` package docs/README for the headless run + streaming API before writing this.
   - Run the agent against the target codebase root (env `SLOOP_TARGET_REPO`, default the workspace root), forwarding Pi's streamed output to `onOutput`.
   - After the agent finishes, run each criterion's `verify` (skip criteria without one), set `passed`, return `{ ok: allPassed }`.
   - Guard with an overall timeout and a `SLOOP_DRY_RUN` env that skips the Pi agent and just runs verify commands (lets the demo work without burning model calls / when offline).
3. Tests: `runVerify` true/false/timeout; `run` in `SLOOP_DRY_RUN` mode against a fake loop whose `verify` is `exit 0` returns `{ ok: true }`; a failing verify returns `{ ok: false }`. (Pi agent calls are integration-tested in WP-6, not unit-mocked here.)

## Verify the Pi agent API
Do NOT guess Pi's API. Read `@earendil-works/pi-ai` and Pi's `agent` package READMEs ([repo](https://github.com/earendil-works/pi/tree/main/packages)) for how to construct an agent, select a model, run headless against a directory, and stream output — then implement against that.

## Definition of done
- `npm run typecheck` clean; `npm test` green.
- `createExecutor(resolved: ResolvedModel)` factory exported for WP-2/WP-6 (returns the one Pi-backed `Executor`).
- Document the env vars (`SLOOP_TARGET_REPO`, `SLOOP_DRY_RUN`, timeouts) in your PR.

## Handoff
WP-2 injects your `Executor` into the cascade engine; WP-6 wires it with the real registry. `SLOOP_DRY_RUN` is the safety valve for a reliable live demo — make sure it works.
