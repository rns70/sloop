import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { createRealApi } from './real';

let root: string;

/** Run git in `root` with a deterministic identity (a repo is required for diffs). */
function git(args: string[]): void {
  execFileSync('git', args, {
    cwd: root,
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'sloop',
      GIT_AUTHOR_EMAIL: 'sloop@earendil.works',
      GIT_COMMITTER_NAME: 'sloop',
      GIT_COMMITTER_EMAIL: 'sloop@earendil.works',
    },
  });
}

async function write(rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
}

const ADR_A = 'loops/adr-a.md';
const ADR_B = 'loops/adr-b.md';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sloop-changes-'));
  // createRealApi reads the model registry on construct; a minimal config is enough — the
  // changes endpoint only exercises the git diff, not model resolution.
  await write('.sloop/config.md', '---\nmodels: {}\nproviders: {}\n---\n# config\n');
  await write(ADR_A, '---\nid: adr-a\ntitle: A\nstatus: idle\n---\n# A\n\noriginal A\n');
  await write(ADR_B, '---\nid: adr-b\ntitle: B\nstatus: idle\n---\n# B\n\noriginal B\n');
  git(['init', '-q']);
  git(['add', '.']);
  git(['commit', '-q', '-m', 'seed']);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('RealApi.getAdrChanges', () => {
  it('reports add/change/delete deltas and strips before/after', async () => {
    await write(ADR_A, '---\nid: adr-a\ntitle: A\nstatus: idle\n---\n# A\n\nchanged A\n');
    await fs.rm(path.join(root, ADR_B));
    await write('loops/adr-c.md', '---\nid: adr-c\ntitle: C\nstatus: idle\n---\n# C\n\nbrand new\n');

    const api = await createRealApi(root, process.env);
    const { changed } = await api.getAdrChanges();
    const byPath = Object.fromEntries(changed.map((c) => [c.relPath, c]));

    expect(byPath[ADR_A].delta).toBe('change');
    expect(byPath[ADR_B].delta).toBe('delete');
    expect(byPath['loops/adr-c.md'].delta).toBe('add');
    expect(Object.keys(byPath[ADR_A]).sort()).toEqual(['delta', 'relPath']);
  });

  it('returns an empty list immediately after a commit', async () => {
    const api = await createRealApi(root, process.env);
    const { changed } = await api.getAdrChanges();
    expect(changed).toEqual([]);
  });
});
