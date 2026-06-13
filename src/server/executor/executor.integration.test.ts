import { describe, it, expect } from 'vitest';
import { runLeafWithRetry } from './retry';
import { validateOutputs } from './sandbox';
import type { LoopDoc } from '../../shared/types';

function leaf(allowedOutputs: string[]): LoopDoc {
  return {
    frontmatter: {
      id: 'l1', kind: 'leaf', role: 'engineer', model: 'haiku',
      status: 'executing', children: [], acceptanceCriteria: [], allowedOutputs,
    },
    body: 'build the feature',
    relPath: 'cascades/c/l1.md',
  };
}

describe('executor seams compose', () => {
  it('rejects an out-of-bounds attempt, then accepts an in-bounds one', async () => {
    const writes = [['code/ok.ts', 'rogue.ts'], ['code/ok.ts']]; // attempt 1 strays, attempt 2 complies
    let i = 0;
    const res = await runLeafWithRetry(leaf(['code/**']), {
      executeAttempt: async (l) => {
        const written = writes[i++];
        return { writtenFiles: written, violations: validateOutputs(written, l.frontmatter.allowedOutputs) };
      },
      verify: async () => true,
      maxAttempts: 3,
    });
    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(2);
    expect(res.evidence[0]).toContain('rogue.ts');
  });
});
