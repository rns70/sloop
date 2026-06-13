import { describe, it, expect } from 'vitest';
import { diffPathSets, SLOOP_OWN_PREFIXES } from './captureWrites';

describe('diffPathSets', () => {
  it('returns paths present after but not before', () => {
    const before = new Set(['code/a.ts']);
    const after = new Set(['code/a.ts', 'code/b.ts']);
    expect(diffPathSets(before, after)).toEqual(['code/b.ts']);
  });

  it('includes modified paths reported in the after set', () => {
    // git status reports modified files too; both snapshots take the porcelain set,
    // so a file modified during the attempt appears in `after` and not `before`.
    expect(diffPathSets(new Set([]), new Set(['code/x.ts']))).toEqual(['code/x.ts']);
  });

  it("excludes sloop's own bookkeeping paths", () => {
    const after = new Set(['code/a.ts', 'databank/adr-1.md', 'cascades/c/l1.md', '.sloop/config.md']);
    expect(diffPathSets(new Set(), after)).toEqual(['code/a.ts']);
  });

  it('exposes the excluded prefixes for reuse', () => {
    expect(SLOOP_OWN_PREFIXES).toContain('databank/');
    expect(SLOOP_OWN_PREFIXES).toContain('cascades/');
    expect(SLOOP_OWN_PREFIXES).toContain('.sloop/');
  });
});
