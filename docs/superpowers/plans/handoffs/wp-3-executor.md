# Handoff — WP-3: Executor (Claude Code + verify) (backend)

> **Stage 2 — parallel. Depends on WP-0 only. Fully independent of the other backend WPs.**

## Before you start
Read the spec (§4.4 execution engine, §3 the `verify` note) and the overview. Branch: `wp-3-executor`. Implement the `Executor` interface from `src/shared/services.ts`.

## Your goal
Given a leaf `LoopDoc`, run a coding agent to do the work, stream its output, then run each acceptance criterion's `verify` command to decide pass/fail. **Two executors behind the one `Executor` interface**, selected by the leaf's resolved model provider (§6.3 of the spec):
- **Anthropic models → Claude Code** subprocess.
- **Nebius models (e.g. NVIDIA Nemotron) → an OpenAI-compatible API agent loop** (Claude Code is Anthropic-only).
Keep it to exactly these two — no general plugin framework (cut for the hackathon).

## You own
- `src/server/executor/` — `index.ts` (factory + provider dispatch), `claudeCodeExecutor.ts`, `openaiCompatExecutor.ts`, `verify.ts`, tests.
Do not touch anything else. Depend only on shared types + the shared `resolveModel` helper.

## Tasks
1. `verify.ts`: `runVerify(command, cwd): Promise<boolean>` — spawn the command via `child_process`, resolve `true` iff exit code 0. Apply a timeout (env `SLOOP_VERIFY_TIMEOUT_MS`, default 120000) → treat timeout as fail. Pure-ish and unit-testable with trivial commands (`exit 0` vs `exit 1`).
2. `claudeCodeExecutor.ts`: implement `Executor.run(loop, onOutput)`:
   - Build a prompt/brief from the loop body + its `acceptanceCriteria`.
   - Spawn Claude Code non-interactively (`claude -p "<brief>" --output-format stream-json` or the current headless flag — verify against the `claude-code-guide`/docs before finalizing the exact invocation). Stream stdout chunks to `onOutput`.
   - Working dir = the target codebase root (env `SLOOP_TARGET_REPO`, default the workspace root).
   - After the agent exits, run each criterion's `verify` (skip criteria without one), set `passed`, and return `{ ok: allPassed }`.
   - Guard with an overall timeout and a `SLOOP_DRY_RUN` env that, when set, skips the spawn and just runs verify commands (lets the demo work without burning agent calls / when offline).
3. `openaiCompatExecutor.ts`: implement `Executor.run` for Nebius-hosted models. Use the `openai` SDK pointed at the resolved `baseUrl` (Nebius AI Studio, `https://api.studio.nebius.ai/v1`) with the resolved key; run a minimal tool-use/edit loop (or, for the hackathon, a single completion that proposes edits applied to `SLOOP_TARGET_REPO`), streaming tokens to `onOutput`, then run `verify`. Model id comes from the registry (e.g. `nvidia/llama-3.1-nemotron-70b-instruct`).
4. `index.ts`: `createExecutor(resolved: ResolvedModel)` returns the Claude Code executor when `resolved.provider === 'anthropic'`, else the OpenAI-compatible one. A leaf's model is resolved via the shared `resolveModel` helper + `FilesService.readModelRegistry()` (WP-2/WP-6 pass the resolved model in).
5. Tests: `runVerify` true/false/timeout; `run` in `SLOOP_DRY_RUN` mode against a fake loop whose `verify` is `exit 0` returns `{ ok: true }` and streams nothing; a failing verify returns `{ ok: false }`; the factory dispatches to the right executor per provider.

## Verify the CLI invocation
Do NOT guess Claude Code's headless flags. Check the `claude-code-guide` skill or `claude --help` for the current non-interactive / print-mode invocation and output streaming format, then implement against that.

## Definition of done
- `npm run typecheck` clean; `npm test` green.
- `createExecutor()` factory exported for WP-2/WP-6.
- Document the env vars (`SLOOP_TARGET_REPO`, `SLOOP_DRY_RUN`, timeouts) in your PR.

## Handoff
WP-2 injects your `Executor` into the cascade engine; WP-6 wires the real one. `SLOOP_DRY_RUN` is the safety valve for a reliable live demo — make sure it works.
