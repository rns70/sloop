import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRealApi, Conflict, NotFound } from './real';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sloop-del-'));
  await fs.mkdir(path.join(root, 'databank/auth'), { recursive: true });
  await fs.mkdir(path.join(root, '.sloop'), { recursive: true });
  await fs.writeFile(path.join(root, 'databank/a.md'), '---\nid: a\ntitle: A\n---\n\nBody.\n', 'utf8');
  await fs.writeFile(
    path.join(root, 'databank/auth/b.md'),
    '---\nid: b\ntitle: B\n---\n\nBody.\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(root, '.sloop/config.md'),
    '---\nmodels: {}\nproviders:\n  anthropic: { apiKeyEnv: ANTHROPIC_API_KEY }\n---\n',
    'utf8',
  );
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('RealApi.deleteAdr', () => {
  it('deletes a single file', async () => {
    const api = await createRealApi(root, { SLOOP_DRY_RUN: '1' } as NodeJS.ProcessEnv);
    await api.deleteAdr('databank/a.md');
    const relPaths = (await api.listAdrs()).map((x) => x.relPath);
    expect(relPaths).not.toContain('databank/a.md');
    expect(relPaths).toContain('databank/auth/b.md');
  });

  it('deletes a whole folder subtree and prunes the empty dir', async () => {
    const api = await createRealApi(root, { SLOOP_DRY_RUN: '1' } as NodeJS.ProcessEnv);
    await api.deleteAdr('databank/auth');
    const relPaths = (await api.listAdrs()).map((x) => x.relPath);
    expect(relPaths).toEqual(['databank/a.md']);
    await expect(fs.access(path.join(root, 'databank/auth'))).rejects.toThrow();
  });

  it('throws NotFound for a missing path', async () => {
    const api = await createRealApi(root, { SLOOP_DRY_RUN: '1' } as NodeJS.ProcessEnv);
    await expect(api.deleteAdr('databank/nope.md')).rejects.toBeInstanceOf(NotFound);
  });

  it('throws Conflict when refusing to delete outside databank/', async () => {
    const api = await createRealApi(root, { SLOOP_DRY_RUN: '1' } as NodeJS.ProcessEnv);
    await expect(api.deleteAdr('.sloop/config.md')).rejects.toBeInstanceOf(Conflict);
  });
});
