# Handoff — WP-8: Eval harness + task suite

> **Stage 3 — runs after WP-6 (needs the real engine + executor + pi-ai cost). The harness *code* can be written earlier against the `CascadeEngine` interface; the *numbers* need the real backend.**

## Before you start
Read **`docs/superpowers/specs/2026-06-13-sloop-evals.md`** (the eval design — task format, result schema, runner flow, data sources) and the main spec (§3 convergence, §6.3 routing). Read the build overview. Branch: `wp-8-eval-harness`.

## Your goal
Produce the headline numbers that prove sloop's claims: **true-convergence rate** (+ false-positive rate), **cost per converged cascade across model mixes**, **Nemotron-as-executor** success/cost/latency, and the **sloop-vs-flat-agent delta on identical tasks** — anchored against **SWE-bench**. Build the task suite (handmade + a small SWE-bench subset) + a runner that records per-run JSON and an aggregate `summary.md`.

## You own
- `evals/repos/` — 1–2 small git-tracked target repos with a real test runner.
- `evals/tasks/*.md` — handmade requirement-change tasks (schema in the eval spec §3).
- `evals/swebench/` — the SWE-bench subset config (instance ids + env setup).
- `evals/results/` — harness output (gitignore everything except `summary.md`).
- `src/eval/` — `runner.ts` (orchestrates `task × mix × system`), `metrics.ts` (types + aggregation), `report.ts` (writes `summary.md`), `swebench.ts` (SWE-bench adapter), `baseline.ts` (the single-agent runner), tests.
Do not edit other WPs' source. You may depend on `CascadeEngine`/`FilesService` (constructed as WP-6 does) and shared types. Add an `npm run eval` script.

## Tasks
1. `metrics.ts`: the result type **exactly** as in eval spec §4 — incl. the **`system: 'sloop' | 'baseline-flat'`** field — (`taskId`, `system`, `modelMix`, `converged`, `independentPass`, `falsePositive`, `criteria`, `tree`, `cost`, `latencyMs`, `error`) + an `aggregate(runs)` producing convergence rate, false-positive rate, per-mix `{successRate, meanUsd, meanLatencyMs}`, **and the sloop-vs-baseline-flat delta** (resolved% and mean $ on the same tasks).
2. Task loader: parse `evals/tasks/*.md` (frontmatter via `gray-matter`) into typed tasks (`id`, `repo`, `baseRef`, `adrPath`, `heldOut[]`, `modelMixes[]`, body).
3. **SWE-bench adapter** (`swebench.ts`): ingest a small set of SWE-bench instances and map each into the same task type — `problem_statement` → requirement body written to `adrPath`; `FAIL_TO_PASS` + `PASS_TO_PASS` → `heldOut`; run inside the instance's prepared environment/image; `baseRef` = the instance's base commit. Keep the subset to 5–10 (label outputs "N tasks from SWE-bench Lite", never a full-benchmark score).
4. `runner.ts` — for each `(task × modelMix × system)`, run the eval spec §5 flow:
   - reset repo (`git -C <repo> checkout <baseRef> && git clean -fd`) — or reset the SWE-bench instance env,
   - write the task body+criteria to `adrPath` in the databank,
   - set models for the run (planner + execute — see Integration below),
   - run the system: **`sloop`** = kick off the cascade **with auto-approve**, wait for the root loop to reach `done`/`blocked`/`failed` (timeout → `error`); **`baseline-flat`** = hand the same requirement + repo to a single Pi agent (no decomposition/routing) on the run's execute model,
   - `converged = root === 'done'` (sloop) / agent-reported-complete (baseline),
   - run each `heldOut` command in the repo (`child_process`), `independentPass = all exit 0`,
   - collect cost (by model), tree loops/maxDepth, latency, criteria counts,
   - append the JSON line to `evals/results/<run-id>/runs.jsonl`, reset the repo.
5. `report.ts`: read `runs.jsonl` → write `evals/results/<run-id>/summary.md`: convergence + false-positive rate, the per-mix table, the **sloop-vs-baseline-flat delta**, and a line citing the SWE-bench Verified ≈95% reference as backdrop (eval spec §8) — clearly marked as context, not a claimed rank.
6. Author the **handmade task suite**: 3–5 scenarios (decomposition/template showcases). Held-out suites genuinely separate from agent-visible `verify`. Tiny-but-real target repos.
7. Tests: `aggregate()` math (convergence %, false-positive %, per-mix means, sloop-vs-baseline delta) on hand-built run arrays; task-file + SWE-bench parsing; a `SLOOP_DRY_RUN` smoke test of the runner on one task of each system (plumbing only, not real numbers).

## Integration points (from eval spec §7 — confirm they exist, else add minimally)
- **Auto-approve:** the runner must approve without a human. Use `CascadeEngine` programmatically and call `approve()` directly after `kickoff()`, or honor `SLOOP_AUTO_APPROVE=1`. (Keep auto-approve OFF in the app itself.)
- **Per-run model override:** set planner + execute models per run via env (`SLOOP_PLANNER_MODEL` + an execute-default override) resolving through the §6.3 registry. If no execute-override hook exists, add a small one.
- **Usage capture:** read per-cascade token/cost from where WP-2/WP-3 record pi-ai usage (e.g. `_cascade.md` frontmatter or `cascade.usage.json`). If usage isn't being recorded yet, add the minimal aggregation in coordination with WP-6.

## Definition of done
- `npm run typecheck` + `npm test` green for your files.
- `npm run eval` runs the suite (handmade + SWE-bench subset, both systems) against the real backend and writes `runs.jsonl` + `summary.md`; commit `summary.md` with the captured numbers.
- `summary.md` shows: true-convergence rate, false-positive rate, the cost-vs-mix table, the Nemotron line, the **sloop-vs-baseline-flat delta**, and the SWE-bench Verified reference backdrop — enough to present from the cache without re-running.

## Reminder
Real runs spend tokens. Curate ~5 tasks, run the 3-mix matrix once, present from the cached `summary.md`. `SLOOP_DRY_RUN` is for smoke-testing plumbing, never for the headline numbers.
