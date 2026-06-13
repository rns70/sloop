# sloop eval harness (WP-8)

Produces the headline numbers that back sloop's three claims (eval design spec
`docs/superpowers/specs/2026-06-13-sloop-evals.md`):

1. **Convergence is real** — true-convergence rate + false-positive rate (held-out suite).
2. **Plan-big / execute-cheap saves money** — cost per converged cascade across model mixes.
3. **Multi-provider works** — Nemotron (via Nebius) as executor: success / cost / latency.

…plus the honest **sloop-vs-baseline-flat delta on identical tasks**, with the SWE-bench
Pro standardized ≈59% figure as *backdrop* (context, not a claimed rank).

## Layout

```
evals/
  repos/toolkit/        tiny git-tracked target repo (node --test) for handmade tasks
  tasks/*.md            handmade requirement-change tasks (frontmatter + body, spec §3)
  swebench/subset.json  5-instance SWE-bench Lite subset config (sync fields before a real run)
  results/<run-id>/     runs.jsonl (gitignored) + summary.md + meta.json (committed)
src/eval/               runner, metrics, cost, report, swebench adapter, baseline, engine wiring
```

## Run it

```bash
# Plumbing smoke — offline, no keys, agents skipped. NEVER headline numbers.
SLOOP_DRY_RUN=1 npm run eval -- --run-id dry-run-smoke

# Real run (spends tokens). Requires provider keys for the aliases in
# fixtures/sample-workspace/.sloop/config.md:
export ANTHROPIC_API_KEY=sk-...      # opus / sonnet / haiku
export NEBIUS_API_KEY=...            # nemotron (Nebius AI Studio)
npm run eval                         # full matrix, both systems, N=1
npm run eval -- --trials 3           # N≥3 for any headline number (mean ± stdev + pass@k)
npm run eval -- --systems sloop      # restrict systems
npm run eval -- --no-swebench        # handmade tasks only

# Compare two runs (resolved% + $ deltas — "did this change help?")
npm run eval -- --compare <runA> <runB>
```

Each run writes `evals/results/<run-id>/summary.md` (committed) — present from that cache,
don't re-run live (real runs are token-spendy; curate ~5 tasks, run the matrix once).

## SWE-bench (real runs)

`swebench/subset.json` ships real instance ids but **placeholder** `base_commit` /
`FAIL_TO_PASS` / `PASS_TO_PASS` (`<SYNC-FROM-DATASET>`). Before a real SWE-bench run:

1. Populate the exact fields from `princeton-nlp/SWE-bench_Lite` (see `_howToPopulate` in the file).
2. `docker pull` the matching `swebench/sweb.eval.*` images.
3. `npm run eval` — the runner copies each image's repo into scratch, runs the agent there,
   and runs the held-out suite in a container over the edits.

Without docker (or in `SLOOP_DRY_RUN`), SWE-bench tasks are **skipped with a logged reason** —
the handmade headline numbers are unaffected.

## Integration hooks (eval spec §7 — all satisfied without editing WP-2/WP-3 source)

- **Auto-approve** — the runner calls `engine.approve()` directly after `kickoff()` (no human
  checkpoint). The app keeps the checkpoint; only the harness bypasses it.
- **Per-run model override** — planner via `SLOOP_PLANNER_MODEL=<mix.plan>` (the architect's own
  hook); executor forced onto `<mix.execute>` for every leaf by constructing it with that one
  resolved model (`src/eval/engine.ts`).
- **Usage capture** — a custom planner `call` records the planner message's pi-ai `usage`; the
  eval executor records `session.getSessionStats()` tokens. Both feed one `UsageAccumulator`
  per run → `RunResult.cost` (USD via the rate card in `src/eval/cost.ts`, approximate list
  prices — override before quoting).

## Reproducibility (spec §10)

Every run resets its repos (`git reset --hard <baseRef> && git clean -fd`) and writes a fresh
`results/<run-id>/`. `summary.md` records the resolved model ids + providers (pinning), the
task-set, the date, and N. LLM stochasticity is real — use `--trials N` (N≥3) and present
mean ± stdev, never a lone number.
