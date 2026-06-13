# sloop eval — results

> ⚠️ **SLOOP_DRY_RUN (plumbing-only).** Agents were skipped; only held-out/verify commands ran. These numbers prove the harness wiring — they are **NOT** headline results. Re-run with API keys (no `SLOOP_DRY_RUN`) for real numbers.

## Run metadata (self-describing — spec §10)

- **Run id:** `dry-run-smoke`
- **Date:** 2026-06-13T12:34:37.018Z
- **Trials (N):** 1
- **Total runs:** 18
- **Tasks (3):** `001-add-slugify`, `002-add-clamp`, `003-sum-handles-empty`
- **Resolved models (pinning):**
  - `opus` → anthropic:`claude-opus-4-8`
  - `haiku` → anthropic:`claude-haiku-4-5-20251001`
  - `nemotron` → nebius:`nvidia/llama-3.1-nemotron-70b-instruct`

## Headline — convergence & honesty (spec §1)

### sloop (full cascade) (9 runs)

- **True-convergence rate:** 100.0%
- **Independent-pass rate:** 0.0%
- **False-positive rate:** 100.0% — converged but held-out failed

### baseline-flat (single Pi agent) (9 runs)

- **True-convergence rate:** 100.0%
- **Independent-pass rate:** 0.0%
- **False-positive rate:** 100.0% — converged but held-out failed


## Cost vs. model mix (claim 2 — plan-big / execute-cheap)

| System | plan → execute | Runs | Success (held-out) | Converged | False-pos | Mean $ | Mean latency |
|---|---|--:|--:|--:|--:|--:|--:|
| sloop | `opus->haiku` | 3 | 0.0% | 100.0% | 100.0% | $0.0000 | 0.7s |
| sloop | `opus->nemotron` | 3 | 0.0% | 100.0% | 100.0% | $0.0000 | 0.7s |
| sloop | `opus->opus` | 3 | 0.0% | 100.0% | 100.0% | $0.0000 | 0.7s |
| baseline-flat | `opus->haiku` | 3 | 0.0% | 100.0% | 100.0% | $0.0000 | 0.2s |
| baseline-flat | `opus->nemotron` | 3 | 0.0% | 100.0% | 100.0% | $0.0000 | 0.2s |
| baseline-flat | `opus->opus` | 3 | 0.0% | 100.0% | 100.0% | $0.0000 | 0.2s |

## sloop vs. baseline-flat — identical tasks (the honest delta)

Computed over the **3 task(s) both systems ran** (same inputs, same hidden tests):

| Metric | sloop | baseline-flat | Δ (sloop − baseline) |
|---|--:|--:|--:|
| Resolved (held-out pass) | 0.0% | 0.0% | +0.0 pts |
| Mean cost / run | $0.0000 | $0.0000 | +$0.0000 |

> Same task, same hidden tests, same scaffold family → the delta isolates sloop's
> decomposition + routing. This is the credible claim; the SWE-bench figure is only backdrop.

## Multi-provider — Nemotron via Nebius (claim 3)

- **sloop** `opus->nemotron`: success 0.0%, mean cost $0.0000, mean latency 0.7s (3 runs).
- **baseline-flat** `opus->nemotron`: success 0.0%, mean cost $0.0000, mean latency 0.2s (3 runs).

> Nemotron (open model, Nebius) as a drop-in executor — same scaffold, different provider.
> Compare its cost/latency against a frontier-executor row above at equal success.

## SWE-bench task set

5 tasks from SWE-bench Lite (labelled as a subset, never a full-benchmark score).

## SWE-bench backdrop (context, not a claimed rank)

External anchor for "are we in a credible range" — **not** a leaderboard placement.
Leaderboard numbers swing ~30 points on harness/scaffold alone, so a small local
subset vs. a published score is apples-to-oranges by construction.

- **SWE-bench Pro (standardized, Scale SEAL public set):** top ≈ **59%** (GPT-5.4) —
  every model run through identical scaffolding. **This is the fair comparator.**
- For reference only: SWE-bench Pro vendor scaffold tops ≈80% (Fable 5); Scale private
  set ≈47%. SWE-bench **Verified** is saturated (~95%), so it frames task *type*, not headroom.

> **Scaffold caveat:** sloop runs its *own* scaffold (decomposition + routing + verify),
> so any sloop number vs. a standardized figure is exactly the apples/oranges to flag.
> The credible claim is the **internal sloop-vs-baseline-flat delta on identical tasks**
> below; the ≈59% figure only frames the neighborhood.
