/**
 * Usage + cost capture (WP-8, eval spec §6 "Cost/tokens" + §7.3 integration point).
 *
 * pi-ai returns token `usage` on every `AssistantMessage` (`{ input, output, ... }`),
 * but neither the planner (WP-2) nor the executor (WP-3) currently aggregates it. The
 * harness captures usage at its own injection boundary — a custom planner `call` and
 * the eval executor both feed an {@link UsageAccumulator} — so no WP-2/WP-3 source is
 * touched. The accumulator turns per-model token counts into USD via an explicit,
 * auditable rate card (so `summary.md` cost numbers can be traced to a published price).
 *
 * Rates are approximate public list prices (USD per 1M tokens, ~June 2026) and are
 * OVERRIDABLE — pinning the exact price you were billed at belongs in the run, not in
 * code. They drive the *cost story* (claim 2), so they're explicit, not hidden.
 */

import type { ModelCost, RunCost } from './types';

/** Price card for one model alias: USD per 1,000,000 tokens. */
export interface RateCard {
  inputPerMTok: number;
  outputPerMTok: number;
}

/** Token counts captured from a pi-ai `Usage` (only the fields we bill on). */
export interface TokenUsage {
  input: number;
  output: number;
}

/**
 * Default rate cards keyed by registry alias (NOT provider model id), matching the
 * sample-workspace registry (`opus`/`sonnet`/`haiku`/`nemotron`). Approximate public
 * list prices ~June 2026 — verify before quoting. Nemotron-via-Nebius is the cheap
 * open-model executor that anchors the multi-provider claim.
 */
export const DEFAULT_RATES: Readonly<Record<string, RateCard>> = {
  opus: { inputPerMTok: 15, outputPerMTok: 75 },
  sonnet: { inputPerMTok: 3, outputPerMTok: 15 },
  haiku: { inputPerMTok: 0.8, outputPerMTok: 4 },
  nemotron: { inputPerMTok: 0.13, outputPerMTok: 0.4 },
};

/** Fallback rate for an unknown alias — zero, so a missing price is visibly $0, not a guess. */
const ZERO_RATE: RateCard = { inputPerMTok: 0, outputPerMTok: 0 };

/** Compute USD for a token usage under a rate card. */
export function usdFor(usage: TokenUsage, rate: RateCard): number {
  return (usage.input * rate.inputPerMTok + usage.output * rate.outputPerMTok) / 1_000_000;
}

/**
 * Accumulates per-model token usage across all calls in one run, then rolls it up
 * into the {@link RunCost} shape the result schema (spec §4) expects.
 *
 * Resilient by design: `record` accepts a loose usage object (only `input`/`output`
 * are read) and tolerates missing fields, because a provider that omits usage on a
 * streamed response must degrade to $0 for that call, never crash the run.
 */
export class UsageAccumulator {
  private readonly byModel = new Map<string, TokenUsage>();
  private readonly rates: Readonly<Record<string, RateCard>>;

  constructor(rates: Readonly<Record<string, RateCard>> = DEFAULT_RATES) {
    this.rates = rates;
  }

  /** Record one call's usage against a model alias. Unknown/partial fields count as 0. */
  record(alias: string, usage: { input?: number; output?: number } | null | undefined): void {
    const input = Number(usage?.input) || 0;
    const output = Number(usage?.output) || 0;
    const prev = this.byModel.get(alias) ?? { input: 0, output: 0 };
    this.byModel.set(alias, { input: prev.input + input, output: prev.output + output });
  }

  private rateFor(alias: string): RateCard {
    return this.rates[alias] ?? ZERO_RATE;
  }

  /** Roll up into per-model + total cost/tokens (the `RunResult.cost` field). */
  total(): RunCost {
    const byModel: Record<string, ModelCost> = {};
    let usd = 0;
    let tokensIn = 0;
    let tokensOut = 0;

    for (const [alias, usage] of this.byModel) {
      const modelUsd = usdFor(usage, this.rateFor(alias));
      byModel[alias] = { usd: modelUsd, tokensIn: usage.input, tokensOut: usage.output };
      usd += modelUsd;
      tokensIn += usage.input;
      tokensOut += usage.output;
    }

    return { usd, tokensIn, tokensOut, byModel };
  }
}

/** An empty cost rollup — used for dry-run / errored runs that spent nothing. */
export function emptyCost(): RunCost {
  return { usd: 0, tokensIn: 0, tokensOut: 0, byModel: {} };
}
