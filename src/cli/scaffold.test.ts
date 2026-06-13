import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { scaffold } from './scaffold';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sloop-scaffold-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const exists = async (p: string) =>
  fs.access(path.join(dir, p)).then(() => true).catch(() => false);

describe('scaffold', () => {
  it('creates the workspace tree and a git repo', async () => {
    const result = await scaffold(dir);
    expect(await exists('.sloop/config.md')).toBe(true);
    expect(await exists('.sloop/workflows/spec-driven.md')).toBe(true);
    expect(await exists('loops/PRD.md')).toBe(true);
    expect(await exists('loops/architecture/architecture.md')).toBe(true);
    expect(await exists('loops/plans/implementation-plan.md')).toBe(true);
    expect(await exists('loops/build/build.md')).toBe(true);
    expect(await exists('.git')).toBe(true);
    expect(await exists('.gitignore')).toBe(true);
    expect(result.gitInitialized).toBe(true);
    expect(result.created).toContain('.sloop/config.md');
  });

  it('is idempotent and never overwrites edited files', async () => {
    await scaffold(dir);
    await fs.writeFile(path.join(dir, '.sloop/config.md'), 'EDITED', 'utf8');

    const result = await scaffold(dir);

    expect(await fs.readFile(path.join(dir, '.sloop/config.md'), 'utf8')).toBe('EDITED');
    expect(result.created).not.toContain('.sloop/config.md');
    expect(result.gitInitialized).toBe(false);
  });

  it('does not re-init git when the dir is already a repo', async () => {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    const result = await scaffold(dir);
    expect(result.gitInitialized).toBe(false);
  });

  it('adds cascades/ to .gitignore exactly once across runs', async () => {
    await scaffold(dir);
    await scaffold(dir);
    const ignore = await fs.readFile(path.join(dir, '.gitignore'), 'utf8');
    expect(ignore.match(/^cascades\/$/gm)?.length).toBe(1);
  });
});
