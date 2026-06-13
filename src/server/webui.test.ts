import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mountWebUi } from './webui';

let dir: string;
let server: Server;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sloop-webui-'));
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await fs.rm(dir, { recursive: true, force: true });
});

async function listen(app: express.Express): Promise<string> {
  server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', r));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

describe('mountWebUi', () => {
  it('serves index.html as the SPA fallback for non-API routes', async () => {
    await fs.writeFile(path.join(dir, 'index.html'), '<!doctype html><title>sloop</title>', 'utf8');
    const app = express();
    expect(mountWebUi(app, dir)).toBe(true);
    const base = await listen(app);

    const res = await fetch(`${base}/loops/anything`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('sloop');
  });

  it('returns false and mounts nothing when the dist dir is absent', async () => {
    const app = express();
    expect(mountWebUi(app, path.join(dir, 'does-not-exist'))).toBe(false);
    const base = await listen(app);

    const res = await fetch(`${base}/anything`);
    expect(res.status).toBe(404);
  });
});
