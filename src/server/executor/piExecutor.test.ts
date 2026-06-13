import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import type { AcceptanceCriterion, LoopDoc, ResolvedModel } from '../../shared/types';
import { createExecutor } from './piExecutor';
import { runVerify } from './verify';

const CWD = tmpdir();

// SLOOP_DRY_RUN skips the Pi agent, so no credential is ever read or sent.
const NO_KEY = '';
const DUMMY_MODEL: ResolvedModel = {
  provider: 'anthropic',
  id: 'claude-haiku-4-5-20251001',
  apiKey: NO_KEY,
};

function criterion(over: Partial<AcceptanceCriterion> = {}): AcceptanceCriterion {
  return { id: 'ac-1', text: 'a thing holds', passed: false, ...over };
}

function leaf(criteria: AcceptanceCriterion[]): LoopDoc {
  return {
    relPath: 'cascades/test/leaf.md',
    body: 'do the work',
    frontmatter: {
      id: 'leaf',
      kind: 'leaf',
      role: 'engineer',
      model: 'haiku',
      status: 'executing',
      children: [],
      acceptanceCriteria: criteria,
    },
  };
}

/** Run the executor in dry-run mode with env restored afterward. */
async function runDry(loop: LoopDoc): Promise<{ ok: boolean }> {
  const prevDryRun = process.env.SLOOP_DRY_RUN;
  const prevTarget = process.env.SLOOP_WORKSPACE;
  process.env.SLOOP_DRY_RUN = '1';
  process.env.SLOOP_WORKSPACE = CWD;
  try {
    const executor = createExecutor(() => DUMMY_MODEL);
    return await executor.run(loop, () => {});
  } finally {
    restoreEnv('SLOOP_DRY_RUN', prevDryRun);
    restoreEnv('SLOOP_WORKSPACE', prevTarget);
  }
}

function restoreEnv(key: string, prev: string | undefined): void {
  if (prev === undefined) delete process.env[key];
  else process.env[key] = prev;
}

describe('runVerify', () => {
  afterEach(() => {
    delete process.env.SLOOP_VERIFY_TIMEOUT_MS;
  });

  it('resolves true when the command exits 0', async () => {
    await expect(runVerify('exit 0', CWD)).resolves.toBe(true);
  });

  it('resolves false when the command exits non-zero', async () => {
    await expect(runVerify('exit 1', CWD)).resolves.toBe(false);
  });

  it('resolves false when the command fails to spawn cleanly', async () => {
    await expect(runVerify('this-command-does-not-exist-xyz', CWD)).resolves.toBe(false);
  });

  it('treats a timeout as a failure and kills the command', async () => {
    await expect(runVerify('sleep 5', CWD, { timeoutMs: 50 })).resolves.toBe(false);
  });
});

describe('createExecutor in SLOOP_DRY_RUN mode', () => {
  it('returns { ok: true } and marks the criterion passed when verify exits 0', async () => {
    const loop = leaf([criterion({ id: 'ac-pass', verify: 'exit 0' })]);
    const result = await runDry(loop);
    expect(result).toEqual({ ok: true });
    expect(loop.frontmatter.acceptanceCriteria[0].passed).toBe(true);
  });

  it('returns { ok: false } and marks the criterion failed when verify exits non-zero', async () => {
    const loop = leaf([criterion({ id: 'ac-fail', verify: 'exit 1' })]);
    const result = await runDry(loop);
    expect(result).toEqual({ ok: false });
    expect(loop.frontmatter.acceptanceCriteria[0].passed).toBe(false);
  });

  it('fails the leaf if any criterion fails (mixed pass/fail)', async () => {
    const loop = leaf([
      criterion({ id: 'ac-pass', verify: 'exit 0' }),
      criterion({ id: 'ac-fail', verify: 'exit 1' }),
    ]);
    const result = await runDry(loop);
    expect(result).toEqual({ ok: false });
    expect(loop.frontmatter.acceptanceCriteria[0].passed).toBe(true);
    expect(loop.frontmatter.acceptanceCriteria[1].passed).toBe(false);
  });

  it('skips criteria without a verify command and is vacuously ok when none have one', async () => {
    const loop = leaf([criterion({ id: 'ac-none', verify: undefined })]);
    const result = await runDry(loop);
    expect(result).toEqual({ ok: true });
    // No command -> not adjudicated here, flag left untouched.
    expect(loop.frontmatter.acceptanceCriteria[0].passed).toBe(false);
  });
});
