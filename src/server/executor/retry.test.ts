import { describe, it, expect } from 'vitest';
import { runLeafWithRetry } from './retry';
import type { LoopDoc } from '../../shared/types';
import type { AttemptResult } from './attempt';

function leaf(): LoopDoc {
  return {
    frontmatter: {
      id: 'l1', kind: 'leaf', role: 'engineer', model: 'haiku',
      status: 'executing', children: [], acceptanceCriteria: [],
    },
    body: 'do the thing',
    relPath: 'cascades/c/l1.md',
  };
}

const clean: AttemptResult = { writtenFiles: ['code/a.ts'], violations: [] };

const PASS = { ok: true, failures: [] };
/** One failing criterion, mirroring what verifyCriteria returns on a non-zero verify. */
const FAIL = {
  ok: false,
  failures: [{ id: 'c1', text: 'it works', command: 'exit 1', output: 'boom', notRunnable: false }],
};

describe('runLeafWithRetry', () => {
  it('passes on the first attempt when verify succeeds', async () => {
    let n = 0;
    const res = await runLeafWithRetry(leaf(), {
      executeAttempt: async () => { n++; return clean; },
      verify: async () => PASS,
      maxAttempts: 3,
    });
    expect(res).toEqual({ ok: true, attempts: 1, evidence: [] });
    expect(n).toBe(1);
  });

  it('retries after a failed verify and passes on a later attempt', async () => {
    let n = 0;
    const evidenceSeen: string[][] = [];
    const res = await runLeafWithRetry(leaf(), {
      executeAttempt: async (_l, { priorEvidence }) => { evidenceSeen.push(priorEvidence); n++; return clean; },
      verify: async () => (n >= 2 ? PASS : FAIL), // fail first, pass second
      maxAttempts: 3,
    });
    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(2);
    expect(evidenceSeen[0]).toEqual([]);        // first attempt: no prior evidence
    expect(evidenceSeen[1].length).toBe(1);     // second attempt: fed the failure evidence
  });

  it('retries on a sandbox violation without running verify', async () => {
    let verifyCalls = 0;
    const res = await runLeafWithRetry(leaf(), {
      executeAttempt: async () => ({ writtenFiles: ['evil.sh'], violations: ['evil.sh'] }),
      verify: async () => { verifyCalls++; return PASS; },
      maxAttempts: 2,
    });
    expect(res.ok).toBe(false);
    expect(res.attempts).toBe(2);
    expect(verifyCalls).toBe(0);                 // violation short-circuits verify
    expect(res.evidence.join('\n')).toContain('evil.sh');
  });

  it('stops early without exhausting attempts when a verify is not runnable (prose, exit 127)', async () => {
    let attempts = 0;
    const notRunnable = {
      ok: false,
      failures: [{ id: 'c1', text: 'game over triggers on contact', command: 'game over triggers on contact', output: '/bin/sh: game: command not found', notRunnable: true }],
    };
    const res = await runLeafWithRetry(leaf(), {
      executeAttempt: async () => { attempts++; return clean; },
      verify: async () => notRunnable,
      maxAttempts: 3,
    });
    expect(res.ok).toBe(false);
    expect(res.attempts).toBe(1);          // short-circuited — did NOT loop to 3
    expect(attempts).toBe(1);
    expect(res.evidence.join('\n')).toContain('not a runnable');
  });

  it('returns ok:false with evidence when attempts are exhausted', async () => {
    const res = await runLeafWithRetry(leaf(), {
      executeAttempt: async () => clean,
      verify: async () => FAIL,
      maxAttempts: 3,
    });
    expect(res.ok).toBe(false);
    expect(res.attempts).toBe(3);
    expect(res.evidence.length).toBe(3);
  });
});
