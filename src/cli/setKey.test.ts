import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { keyFilePath, PROVIDER_ENV_VAR, setKey } from './setKey';

describe('keyFilePath', () => {
  it('resolves global to <home>/.sloop/.env and local to <cwd>/.sloop/.env', () => {
    expect(keyFilePath('global', { home: '/home/u' })).toBe('/home/u/.sloop/.env');
    expect(keyFilePath('local', { cwd: '/proj' })).toBe('/proj/.sloop/.env');
  });
});

describe('setKey', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sloop-setkey-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the key into a freshly created .sloop/.env (global)', async () => {
    const file = await setKey({ provider: 'anthropic', value: 'sk-ant-1', scope: 'global', home: dir });
    expect(file).toBe(join(dir, '.sloop', '.env'));
    expect(readFileSync(file, 'utf8')).toBe('ANTHROPIC_API_KEY=sk-ant-1\n');
  });

  it('writes to the project .sloop/.env for the local scope', async () => {
    const file = await setKey({ provider: 'nebius', value: 'nb-1', scope: 'local', cwd: dir });
    expect(file).toBe(join(dir, '.sloop', '.env'));
    expect(readFileSync(file, 'utf8')).toBe(`${PROVIDER_ENV_VAR.nebius}=nb-1\n`);
  });

  it('enforces 0600 permissions on the secret file', async () => {
    const file = await setKey({ provider: 'anthropic', value: 'sk', scope: 'global', home: dir });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('trims surrounding whitespace from the key', async () => {
    const file = await setKey({ provider: 'anthropic', value: '  sk-trim\n', scope: 'global', home: dir });
    expect(readFileSync(file, 'utf8')).toBe('ANTHROPIC_API_KEY=sk-trim\n');
  });

  it('updates an existing key in place and preserves other lines', async () => {
    mkdirSync(join(dir, '.sloop'), { recursive: true });
    writeFileSync(
      join(dir, '.sloop', '.env'),
      '# my keys\nNEBIUS_API_KEY=keep-me\nANTHROPIC_API_KEY=old\n',
    );
    const file = await setKey({ provider: 'anthropic', value: 'new', scope: 'global', home: dir });
    expect(readFileSync(file, 'utf8')).toBe(
      '# my keys\nNEBIUS_API_KEY=keep-me\nANTHROPIC_API_KEY=new\n',
    );
  });

  it('rejects an empty key', async () => {
    await expect(
      setKey({ provider: 'anthropic', value: '   ', scope: 'global', home: dir }),
    ).rejects.toThrow(/empty/i);
  });
});
