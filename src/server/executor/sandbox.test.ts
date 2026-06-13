import { describe, it, expect } from 'vitest';
import { validateOutputs } from './sandbox';

describe('validateOutputs (foundation stub)', () => {
  it('returns no violations when there is no allow-list (legacy loops unrestricted)', () => {
    expect(validateOutputs(['code/a.ts', 'anywhere.ts'], undefined)).toEqual([]);
    expect(validateOutputs(['code/a.ts'], [])).toEqual([]);
  });
});
