import { describe, it, expect } from 'vitest';
import { validateOutputs } from './sandbox';

describe('validateOutputs', () => {
  it('is unrestricted when the allow-list is absent or empty', () => {
    expect(validateOutputs(['anything.ts'], undefined)).toEqual([]);
    expect(validateOutputs(['anything.ts'], [])).toEqual([]);
  });

  it('allows files matching a ** glob', () => {
    expect(validateOutputs(['code/a.ts', 'code/sub/b.ts'], ['code/**'])).toEqual([]);
  });

  it('flags files outside the allow-list as violations', () => {
    expect(validateOutputs(['code/a.ts', 'secrets.env'], ['code/**'])).toEqual(['secrets.env']);
  });

  it('supports single-segment * (not crossing /)', () => {
    expect(validateOutputs(['code/a.ts'], ['code/*.ts'])).toEqual([]);
    expect(validateOutputs(['code/sub/a.ts'], ['code/*.ts'])).toEqual(['code/sub/a.ts']);
  });

  it('matches against any of several globs', () => {
    expect(validateOutputs(['code/a.ts', 'tests/a.test.ts'], ['code/**', 'tests/**'])).toEqual([]);
  });

  it('matches exact literal paths', () => {
    expect(validateOutputs(['code/index.ts', 'code/other.ts'], ['code/index.ts'])).toEqual(['code/other.ts']);
  });
});
