# Handoff — WP-8: Eval harness + task suite

> **Stage 3 — runs after WP-6 (needs the real engine + executor + pi-ai cost). The harness *code* can be written earlier against the `CascadeEngine` interface; the *numbers* need the real backend.**

## Before you start
Read **`docs/superpowers/specs/2026-06-13-sloop-evals.md`** (the eval design — task format, result schema, runner flow, data sources) and the main spec (§3 convergence, §6.3 routing). Read the build overview. Branch: `wp-8-eval-harness`.

## Your goal
Produce the three headline numbers that prove sloop's claims: **true-convergence rate** (+ false-positive rate), **cost per converged cascade across model mixes**, and **Nemotron-as-executor** success/cost/latency. Build a small task suite + a runner that records per-run JSON and an aggregate `summary.md`.

## You own
- `evals/repos/` — 1–2 small git-tracked target repos with a real test runner.
- `evals/tasks/*.md` — 5–10 requirement-change tasks (schema in the eval spec §3).
- `evals/results/` — harness output (gitignore everything except `summary.md`).
- `src/eval/` — `runner.ts` (orchestrates a run), `metrics.ts` (types + aggregation), `report.ts` (writes `summary.md`), tests.
Do not edit other WPs' source. You may depend on `CascadeEngine`/`FilesService` (constructed as WP-6 does) and shared types. Add an `npm run eval` script.

## Tasks
1. `metrics.ts`: the result type **exactly** as in eval spec §4 (`taskId`, `modelMix`, `converged`, `independentPass`, `falsePositive`, `criteria`, `tree`, `cost`, `latencyMs`, `error`) + an `aggregate(runs)` producing convergence rate, false-positive rate, and per-mix `{successRate, meanUsd, meanLatencyMs}`.
2. Task loader: parse `evals/tasks/*.md` (frontmatter via `gray-matter`) into typed tasks (`id`, `repo`, `baseRef`, `adrPath`, `heldOut[]`, `modelMixes[]`, body).
3. `runner.ts` — for each `(task × modelMix)`, run the eval spec §5 flow:
   - reset repo (`git -C evals/repos/<repo> checkout <baseRef> && git clean -fd`),
   - write the task body+criteria to `adrPath` in the databank,
   - set models for the run (planner + execute — see Integration below),
   - kick off the cascade **with auto-approve**, wait for the root loop to reach `done`/`blocked`/`failed` (timeout → `error`),
   - `converged = root === 'done'`,
   - run each `heldOut` command in the repo (`child_process`), `independentPass = all exit 0`,
   - collect cost (by model), tree loops/maxDepth, latency, criteria counts,
   - append the JSON line to `evals/results/<run-id>/runs.jsonl`, reset the repo.
4. `report.ts`: read `runs.jsonl` → write `evals/results/<run-id>/summary.md` (the headline numbers + the per-mix table from eval spec §1/§8).
5. Author the **task suite**: 5–10 scenarios. Each held-out suite must be genuinely separate from the agent-visible `verify` commands. Keep target repos tiny but real (a test command that actually passes/fails).
6. Tests: `aggregate()` math (convergence %, false-positive %, per-mix means) on hand-built run arrays; task-file parsing; a `SLOOP_DRY_RUN` smoke test of the runner on one task (plumbing only, not real numbers).

## Integration points (from eval spec §7 — confirm they exist, else add minimally)
- **Auto-approve:** the runner must approve without a human. Use `CascadeEngine` programmatically and call `approve()` directly after `kickoff()`, or honor `SLOOP_AUTO_APPROVE=1`. (Keep auto-approve OFF in the app itself.)
- **Per-run model override:** set planner + execute models per run via env (`SLOOP_PLANNER_MODEL` + an execute-default override) resolving through the §6.3 registry. If no execute-override hook exists, add a small one.
- **Usage capture:** read per-cascade token/cost from where WP-2/WP-3 record pi-ai usage (e.g. `_cascade.md` frontmatter or `cascade.usage.json`). If usage isn't being recorded yet, add the minimal aggregation in coordination with WP-6.

## Definition of done
- `npm run typecheck` + `npm test` green for your files.
- `npm run eval` runs the suite against the real backend and writes `runs.jsonl` + `summary.md`; commit `summary.md` with the captured numbers.
- `summary.md` shows: true-convergence rate, false-positive rate, the cost-vs-mix table, and the Nemotron line — enough to present from the cache without re-running.

## Reminder
Real runs spend tokens. Curate ~5 tasks, run the 3-mix matrix once, present from the cached `summary.md`. `SLOOP_DRY_RUN` is for smoke-testing plumbing, never for the headline numbers.
