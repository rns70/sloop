import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startServer, type StartedServer } from './index';

const SAMPLE = path.resolve('fixtures/sample-workspace');

let root: string;
let started: StartedServer;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sloop-start-'));
  await fs.cp(SAMPLE, root, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'base'], {
    cwd: root,
  });

  for (const k of ['SLOOP_WORKSPACE', 'SLOOP_DRY_RUN']) saved[k] = process.env[k];
  process.env.SLOOP_DRY_RUN = '1';
  delete process.env.SLOOP_WORKSPACE;

  // Fixed high port so `started.url` matches the bound port (no ephemeral-port mismatch).
  started = await startServer({ root, port: 5199 });
});

afterAll(async () => {
  await started.close();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fs.rm(root, { recursive: true, force: true });
});

describe('startServer', () => {
  it('serves /api/health with the workspace root', async () => {
    const res = await fetch('http://localhost:5199/api/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; workspace: string };
    expect(body.ok).toBe(true);
    expect(body.workspace).toBe(root);
  });

  it('points the executor target (workspace) at root', () => {
    expect(process.env.SLOOP_WORKSPACE).toBe(root);
  });
});
