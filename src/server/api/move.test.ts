import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRealApi, Conflict, NotFound } from './real';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sloop-move-'));
  await fs.mkdir(path.join(root, 'loops/auth'), { recursive: true });
  await fs.mkdir(path.join(root, '.sloop'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'loops/auth/a.md'),
    '---\nid: a\ntitle: A\n---\n\nBody.\n',
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

describe('RealApi.moveAdr', () => {
  it('moves a file and exposes it at its new relPath', async () => {
    const api = await createRealApi(root, { SLOOP_DRY_RUN: '1' } as NodeJS.ProcessEnv);
    await api.moveAdr('loops/auth/a.md', 'loops/api/a.md');
    const adrs = await api.listAdrs();
    expect(adrs.map((x) => x.relPath)).toContain('loops/api/a.md');
    expect(adrs.map((x) => x.relPath)).not.toContain('loops/auth/a.md');
  });

  it('throws NotFound for a missing source', async () => {
    const api = await createRealApi(root, { SLOOP_DRY_RUN: '1' } as NodeJS.ProcessEnv);
    await expect(api.moveAdr('loops/nope.md', 'loops/x.md')).rejects.toBeInstanceOf(NotFound);
  });

  it('throws Conflict on a destination collision', async () => {
    await fs.writeFile(path.join(root, 'loops/auth/b.md'), '---\nid: b\ntitle: B\n---\n', 'utf8');
    const api = await createRealApi(root, { SLOOP_DRY_RUN: '1' } as NodeJS.ProcessEnv);
    await expect(api.moveAdr('loops/auth/a.md', 'loops/auth/b.md')).rejects.toBeInstanceOf(
      Conflict,
    );
  });
});
