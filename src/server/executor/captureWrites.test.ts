import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { diffPathSets, gitDirtySet, SLOOP_OWN_PREFIXES } from './captureWrites';

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
    const after = new Set(['code/a.ts', 'loops/adr-1.md', 'cascades/c/l1.md', '.sloop/config.md']);
    expect(diffPathSets(new Set(), after)).toEqual(['code/a.ts']);
  });

  it('exposes the excluded prefixes for reuse', () => {
    expect(SLOOP_OWN_PREFIXES).toContain('loops/');
    expect(SLOOP_OWN_PREFIXES).toContain('cascades/');
    expect(SLOOP_OWN_PREFIXES).toContain('.sloop/');
  });
});

describe('gitDirtySet (integration, real git repo)', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'sloop-capturewrites-'));
    const git = simpleGit({ baseDir: tmp });
    await git.init();
    // Local identity so any commit operations work without global config.
    await git.addConfig('user.name', 'sloop-test');
    await git.addConfig('user.email', 'sloop-test@example.com');
    // Establish a tracked baseline so the working tree starts clean.
    writeFileSync(join(tmp, 'README.md'), '# baseline\n');
    await git.add('README.md');
    await git.commit('baseline');
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('expands a brand-new untracked subdirectory into individual file paths', async () => {
    const before = await gitDirtySet(tmp);

    // Agent creates a NEW subdirectory with two files. `git status --porcelain`
    // (default) collapses this into a single `code/newmod/` entry; the capture
    // must instead see both real files.
    mkdirSync(join(tmp, 'code', 'newmod'), { recursive: true });
    writeFileSync(join(tmp, 'code', 'newmod', 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(tmp, 'code', 'newmod', 'b.ts'), 'export const b = 2;\n');

    const after = await gitDirtySet(tmp);
    const written = diffPathSets(before, after);

    expect(written).toContain('code/newmod/a.ts');
    expect(written).toContain('code/newmod/b.ts');
    // The collapsed directory path must NOT be what we capture.
    expect(written).not.toContain('code/newmod/');
  });
});
