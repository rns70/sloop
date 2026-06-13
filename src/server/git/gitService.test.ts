import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { simpleGit } from 'simple-git';
import { createGitService } from './gitService';

let root: string;

const ADR_A = 'databank/adr-007-token-rotation.md';
const ADR_B = 'databank/adr-012-device-trust.md';

async function write(rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sloop-git-'));
  await simpleGit(root).init();
  await write(ADR_A, '---\nid: adr-007\n---\n\noriginal A\n');
  await write(ADR_B, '---\nid: adr-012\n---\n\noriginal B\n');
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('GitService', () => {
  it('commitAll returns a 7-char sha and successive commits differ', async () => {
    const git = createGitService(root);

    const first = await git.commitAll('seed databank');
    expect(first).toHaveLength(7);

    await write(ADR_A, '---\nid: adr-007\n---\n\nchanged A\n');
    const second = await git.commitAll('change adr-007');
    expect(second).toHaveLength(7);
    expect(second).not.toBe(first);
  });

  it('diffDatabank detects added, changed, and deleted ADRs vs the last commit', async () => {
    const git = createGitService(root);
    await git.commitAll('seed databank');

    // change A, delete B, add C.
    await write(ADR_A, '---\nid: adr-007\n---\n\nchanged A\n');
    await fs.rm(path.join(root, ADR_B));
    await write('databank/adr-099-new.md', '---\nid: adr-099\n---\n\nbrand new\n');

    const diff = await git.diffDatabank();
    const byPath = Object.fromEntries(diff.changed.map((c) => [c.relPath, c]));

    expect(byPath[ADR_A].delta).toBe('change');
    expect(byPath[ADR_A].before).toContain('original A');
    expect(byPath[ADR_A].after).toContain('changed A');

    expect(byPath[ADR_B].delta).toBe('delete');
    expect(byPath[ADR_B].before).toContain('original B');
    expect(byPath[ADR_B].after).toBe('');

    expect(byPath['databank/adr-099-new.md'].delta).toBe('add');
    expect(byPath['databank/adr-099-new.md'].before).toBe('');
    expect(byPath['databank/adr-099-new.md'].after).toContain('brand new');
  });

  it('reports no databank changes immediately after a commit', async () => {
    const git = createGitService(root);
    await git.commitAll('seed databank');

    const diff = await git.diffDatabank();
    expect(diff.changed).toEqual([]);
  });
});
