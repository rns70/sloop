# sloop — Evaluation Design

**Date:** 2026-06-13
**Status:** Hackathon eval plan
**Companion to:** `2026-06-13-sloop-design.md`

The evals exist to **prove sloop's three claims on a slide**, not to be a research benchmark. Each headline metric maps to one claim. Build the smallest harness that produces these numbers credibly.

---

## 1. Claims → headline metrics

| # | Claim | Headline metric | How shown |
|---|-------|-----------------|-----------|
| 1 | **Convergence is real** — root `done` ⟺ codebase matches databank | **True-convergence rate** = % of cascades reporting `done` whose **held-out** acceptance suite also passes. Plus **false-positive rate** (`done` but held-out fails). | Big number + the live "money shot" |
| 2 | **Plan-big / execute-cheap saves money** | **Cost per converged cascade** across model mixes, at equal success | Cost-vs-mix bars |
| 3 | **Multi-provider works (Nemotron via Nebius)** | Nemotron-as-executor **success rate, cost, latency** vs a frontier model | One row/line in the mix table (sponsor angle) |

**Held-out = not given to the agents.** Each task ships an acceptance suite the agents see (the ADR's `verify` commands) AND a separate held-out suite the harness runs to independently judge convergence. The gap between them is the honesty of the convergence claim.

---

## 2. Supporting metrics (cheap, captured per run)
- **Decomposition:** tree `loops` count, `maxDepth`, **criteria coverage** (every databank criterion got a loop?).
- **Latency:** wall-clock to converge; parallel speedup vs. a forced-sequential run.
- **Verify trustworthiness:** % criteria with an executable `verify` vs. adjudicated; agreement between agent-`passed` and held-out result.

---

## 3. Task suite

5–10 curated **requirement-change scenarios**, quality over quantity. Each task is a markdown file (frontmatter + body), consistent with sloop's markdown-everything ethos.

```
evals/
  repos/
    api-service/                 # small real target repo(s), git-tracked, with a test runner
  tasks/
    001-add-rate-limit.md
    002-rotate-tokens.md
    ...
  results/                       # harness output (gitignored except summary.md)
    <run-id>/runs.jsonl
    <run-id>/summary.md
```

**Task file schema** (`evals/tasks/<id>.md`):
```yaml
---
id: "001-add-rate-limit"
repo: api-service                       # dir under evals/repos/
baseRef: main                           # git ref to reset the repo to before each run
adrPath: databank/adr-020-rate-limit.md # the databank file this task writes/edits
heldOut:                                # independent checks — NOT given to agents
  - "npm test -- rate-limit"
  - "npm run lint"
modelMixes:                             # the matrix to run for this task
  - { plan: opus,  execute: haiku }
  - { plan: opus,  execute: nemotron }
  - { plan: opus,  execute: opus }
---
# Rate-limit the public API

<The requirement text + acceptance criteria the harness writes into `adrPath`
 before triggering the cascade. Criteria here carry their own (agent-visible)
 `verify` commands; the held-out suite above is separate.>
```

**Two task sources** feed the same schema:
- **Handmade tasks** (above) — fast to author, tailored to show decomposition/templates.
- **SWE-bench instances** (§8) — a loader maps a SWE-bench task into this shape: `problem_statement` → the requirement body, the instance's `FAIL_TO_PASS` + `PASS_TO_PASS` → the **held-out** suite, run inside the instance's prepared environment. These give the externally-comparable number.

---

## 4. Result schema

One JSON object per `(task × modelMix × system)` run, appended to `results/<run-id>/runs.jsonl`. `system` is `"sloop"` (full cascade) or `"baseline-flat"` (a single Pi agent on the same task, no decomposition/routing) — the head-to-head that isolates sloop's contribution:
```json
{
  "taskId": "001-add-rate-limit",
  "system": "sloop",
  "modelMix": { "plan": "opus", "execute": "nemotron" },
  "converged": true,
  "independentPass": true,
  "falsePositive": false,
  "criteria": { "total": 3, "passedByAgent": 3, "passedIndependent": 3 },
  "tree": { "loops": 5, "maxDepth": 2 },
  "cost": {
    "usd": 0.42, "tokensIn": 121000, "tokensOut": 18400,
    "byModel": { "opus": { "usd": 0.38, "tokensIn": 90000, "tokensOut": 9000 },
                 "nemotron": { "usd": 0.04, "tokensIn": 31000, "tokensOut": 9400 } }
  },
  "latencyMs": 108000,
  "error": null
}
```
`falsePositive = converged && !independentPass`. `summary.md` aggregates: convergence rate, false-positive rate, a per-mix table of success rate / mean cost / mean latency, **and the sloop-vs-baseline-flat delta** (resolved% and $ on identical tasks).

---

## 5. Runner flow (per task × mix)

1. **Reset** the target repo: `git -C evals/repos/<repo> checkout <baseRef> && git clean -fd`.
2. **Apply** the requirement: write the task body (+criteria) to `adrPath` in the databank.
3. **Route**: set the run's models (planner + execute) — see §6 data sources.
4. **Kick off** the cascade and **auto-approve** the checkpoint (eval mode), then wait for the root loop to reach a terminal status (`done`/`blocked`/`failed`) with a timeout.
5. **Convergence** = root status `done`. Record it.
6. **Independent check**: run each `heldOut` command in the repo; `independentPass` = all exit 0.
7. **Collect** cost/tokens (by model), tree size/depth, latency, criteria counts.
8. **Record** the JSON line; reset the repo.

Run the full matrix **for both systems** — `sloop` (full cascade) and `baseline-flat` (one Pi agent handed the same requirement + repo, no decomposition or routing) — then write `summary.md`. Same task, same hidden tests → the delta is purely sloop's orchestration.

---

## 6. Data sources (what the harness reads, not re-implements)

- **Convergence + tree:** the cascade's markdown files / `CascadeEngine` (or `GET /api/cascades/:id`) — root status and the loop list (counts, depth, agent-`passed`).
- **Cost/tokens:** `pi-ai`'s usage/cost tracking. Requires each model call's usage to be aggregated per cascade. **Integration point** (confirm/add): planner (WP-2) and executor (WP-3) record per-call `usage` (tokens + cost + model) so the harness can sum it — e.g. into the cascade's `_cascade.md` frontmatter or a `cascade.usage.json`.
- **Held-out result:** the harness runs the commands itself (`child_process`), independent of anything the agents did.
- **Latency:** wall-clock around step 4.

---

## 7. Integration points to confirm (coordinate; small)
1. **Auto-approve mode** — evals can't click the checkpoint. Need a non-interactive approve (e.g. `SLOOP_AUTO_APPROVE=1` or an engine `kickoff({ autoApprove: true })`). Off by default in the app.
2. **Per-run model override** — the harness must set planner + execute models per run (env `SLOOP_PLANNER_MODEL` + an execute-default override, or by writing role/template defaults). Resolves via the §6.3 registry.
3. **Usage capture** — per-cascade token/cost aggregation from pi-ai (above).

These are the only things the harness needs from the rest of the build; if absent, they're tiny additions for WP-2/WP-3/WP-6.

---

## 8. External benchmark: SWE-bench

SWE-bench is the right external anchor because its structure *is* sloop's eval shape: a repo + an issue + **hidden tests** (`FAIL_TO_PASS`/`PASS_TO_PASS`). The mapping: issue `problem_statement` → the requirement we write to the databank; hidden tests → the **held-out** suite; **resolved%** → our **true-convergence rate**.

**Variants:**
- **SWE-bench Verified** (500 human-validated) — the number people cite; use as the *reference*.
- **SWE-bench Lite** (300) or a **hand-picked 5–10 subset** — what we actually *run*. Always label as "N tasks from SWE-bench Lite," never as a full-benchmark score.

**The honest comparison is internal-on-identical-tasks.** External leaderboards use different scaffolds, so a raw subset number vs. the leaderboard is noisy. Lead with **sloop (cascade) vs. baseline-flat (single Pi agent)** on the *same* SWE-bench instances (the `system` field, §4–§5) — same inputs, same hidden tests, so the delta is purely sloop's decomposition + routing. Then cite the leaderboard as *context* for "are we in a credible range."

**Reference points (as of June 2026 — verify before the demo; numbers move and vary by source/scaffold):** SWE-bench Verified tops out ≈ **95%** (frontier models: Claude Mythos 5 ≈95.5%, Fable 5 ≈95%, Opus 4.8 ≈88.6%); the harder **SWE-bench Pro** tops ≈ **80%**. A typical task burns **~30–80K tokens** (≈55K midpoint) — handy for sizing cost. Cite these as the backdrop your subset sits against; do **not** claim a leaderboard rank from a small subset.

**Feasibility:** SWE-bench instances ship as prepared environments (Docker images) with their own test harness, mostly Python repos. Wiring sloop's Pi-agent executor + the held-out test run into a couple of those images is the bulk of the effort — keep the subset small (5–10) and budget for the env plumbing.

## 9. Presentation
Demo arc: **(1)** live convergence money shot → **(2)** `summary.md` as a results view: convergence rate + false-positive rate, the **sloop-vs-flat-agent delta** on identical SWE-bench tasks, the cost-vs-mix bars, and the **Nemotron** line — with the SWE-bench Verified ≈95% reference as backdrop. Story: *it works (and beats a flat agent on the same tasks) → it's cheap → it's open/multi-provider.* If time allows, a small "Evals" page in the UI renders `summary.md`.

**Hackathon scope:** real runs are token-spendy. Curate ~5 tasks, run the 3-mix matrix once, cache results to `runs.jsonl`, and present from the cache (don't re-run live). `SLOOP_DRY_RUN` is for smoke-testing the harness plumbing offline, not for the real numbers.
