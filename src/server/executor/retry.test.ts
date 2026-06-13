import { describe, it, expect } from 'vitest';
import { runLeafWithRetry } from './retry';
import type { LoopDoc } from '../../shared/types';

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

describe('runLeafWithRetry (foundation stub: single attempt)', () => {
  it('runs one attempt and reports the verify result', async () => {
    let attempts = 0;
    const res = await runLeafWithRetry(leaf(), {
      executeAttempt: async () => { attempts += 1; return { writtenFiles: [], violations: [] }; },
      verify: async () => true,
      maxAttempts: 3,
    });
    expect(attempts).toBe(1);
    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(1);
  });
});
