import { describe, expect, it } from 'vitest';
import { DEFAULT_RATES, UsageAccumulator, emptyCost, usdFor } from './cost';

describe('usdFor', () => {
  it('prices input + output tokens per million', () => {
    // 1M input @ $3 + 0.5M output @ $15 = 3 + 7.5
    expect(usdFor({ input: 1_000_000, output: 500_000 }, DEFAULT_RATES.sonnet)).toBeCloseTo(10.5, 6);
  });
});

describe('UsageAccumulator', () => {
  it('aggregates per-model tokens and rolls up totals + cost', () => {
    const acc = new UsageAccumulator();
    acc.record('opus', { input: 90_000, output: 9_000 }); // planner
    acc.record('haiku', { input: 31_000, output: 9_400 }); // executor
    acc.record('haiku', { input: 1_000, output: 600 }); // a second leaf call
    const total = acc.total();

    expect(total.byModel.opus.tokensIn).toBe(90_000);
    expect(total.byModel.haiku.tokensIn).toBe(32_000);
    expect(total.byModel.haiku.tokensOut).toBe(10_000);
    expect(total.tokensIn).toBe(122_000);
    expect(total.tokensOut).toBe(19_000);

    // opus: 90k*15 + 9k*75 per M ; haiku: 32k*0.8 + 10k*4 per M
    const opusUsd = (90_000 * 15 + 9_000 * 75) / 1_000_000;
    const haikuUsd = (32_000 * 0.8 + 10_000 * 4) / 1_000_000;
    expect(total.byModel.opus.usd).toBeCloseTo(opusUsd, 6);
    expect(total.byModel.haiku.usd).toBeCloseTo(haikuUsd, 6);
    expect(total.usd).toBeCloseTo(opusUsd + haikuUsd, 6);
  });

  it('tolerates missing/partial usage (degrades to 0, never throws)', () => {
    const acc = new UsageAccumulator();
    acc.record('haiku', undefined);
    acc.record('haiku', { input: 100 }); // no output
    const total = acc.total();
    expect(total.byModel.haiku.tokensIn).toBe(100);
    expect(total.byModel.haiku.tokensOut).toBe(0);
  });

  it('unknown alias gets a zero rate (visible $0, not a guess)', () => {
    const acc = new UsageAccumulator();
    acc.record('mystery-model', { input: 1_000_000, output: 1_000_000 });
    const total = acc.total();
    expect(total.byModel['mystery-model'].tokensIn).toBe(1_000_000);
    expect(total.usd).toBe(0);
  });
});

describe('emptyCost', () => {
  it('is an all-zero rollup', () => {
    expect(emptyCost()).toEqual({ usd: 0, tokensIn: 0, tokensOut: 0, byModel: {} });
  });
});
