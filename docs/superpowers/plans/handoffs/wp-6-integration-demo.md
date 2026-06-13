# Handoff — WP-6: Integration + demo + polish

> **Stage 3 — serial, LAST, one agent. Depends on WP-1…WP-5 all merged.**

## Before you start
Read the spec (§9 demo happy path) and the overview. Branch: `wp-6-integration`. Your job is to replace the mock with the real backend and make the single demo happy path work end to end, then polish.

## Your goal
Construct the real services, wire them into the API layer in place of WP-0's mock, run the genuine cascade flow against a sample target repo, and make the demo reliable.

## You own
- `src/server/api/` — real route handlers replacing `mock.ts` (keep mock available behind an env flag `SLOOP_MOCK=1` as a fallback for a safe demo).
- `src/server/index.ts` — final wiring.
- `scripts/demo.md` (or `.sh`) — the exact demo runbook.
- Cross-cutting polish only where needed; prefer flagging over editing another WP's internals.

## Tasks
1. **Bootstrap Pi providers:** at server startup, read the model registry (`FilesService.readModelRegistry()`) and map it onto Pi via `pi-ai`'s `registerProvider` — in particular register `nebius` as OpenAI-compatible (`api:'openai-completions'`, `baseUrl` + key from the registry) so NVIDIA Nemotron works. Then construct real services: `createFilesService()`, `createGitService()`, `createExecutor(resolved)`, `createCascadeEngine({ files, git, executor })`, and WP-7's `authorService` (real `POST /api/author` via pi-ai). Mount real handlers for every endpoint in the overview's API table; back the WS stream with the executor's `onOutput` and cascade status updates.
2. Pick the swap point: `SLOOP_MOCK=1` → mock (today's behavior), unset → real. This guarantees you always have a working demo even if the real path is flaky.
3. Prepare a **sample target repo** (small, real, with a test command) and an ADR whose `verify` command maps to that test. Set `SLOOP_TARGET_REPO`, `SLOOP_PLANNER_MODEL`, `SLOOP_MAX_DEPTH=2`.
4. Run the happy path for real once (or in `SLOOP_DRY_RUN` if agent calls are unreliable): edit ADR → kickoff (`spec-driven`) → architect proposes tree → approve → leaves run → verify passes → root flips to `done`. Fix the seams that break.
5. Write `scripts/demo.md`: the precise click-by-click + env setup for the live demo, plus the fallback (`SLOOP_MOCK=1` / `SLOOP_DRY_RUN=1`).
6. Final polish pass: empty states, error toasts on failed fetches, the root-`done` success state, and make sure `npm run dev` is a single clean command.

## Definition of done
- `npm run typecheck` + `npm test` green across the repo.
- The demo happy path works end to end against the real backend (verified, not assumed) — capture the terminal/agent output in your PR.
- `SLOOP_MOCK=1` still serves the full UI as a guaranteed fallback.
- `scripts/demo.md` is accurate enough that someone else could run the demo cold.

## Reminder
This is a hackathon — when the happy path works and looks good, STOP. Do not gold-plate the cut list (§9). A reliable 90-second demo beats a fragile feature-complete one.
