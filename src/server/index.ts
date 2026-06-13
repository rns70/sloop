// sloop backend entrypoint. Two ways in:
//   - main():        env-driven (PORT, SLOOP_WORKSPACE) — the npm scripts.
//   - startServer(): programmatic, used by the `sloop` CLI to serve a project dir.
// Both build the same app via buildServer(); only construction + listen differ.

import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import type { Server } from 'node:http';
import { createRealApi } from './api/real';
import { buildServer } from './buildServer';
import { loadDotEnv } from './env';

const DEFAULT_PORT = 5174;
// dist/web lives at the repo root, two levels up from src/server/.
const DIST_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist/web');

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      resolvePromise();
    });
  });
}

export interface StartedServer {
  url: string;
  uiMounted: boolean;
  close: () => Promise<void>;
}

/**
 * Start the real backend against `root` (workspace AND agent target repo), serving the
 * API + WS + built UI on one port. Used by the `sloop` CLI. `root` must be a git repo.
 */
export async function startServer(opts: { root: string; port?: number }): Promise<StartedServer> {
  loadDotEnv(); // Provider keys from a gitignored .env; real shell env still wins.
  const root = resolve(opts.root);
  const port = opts.port ?? DEFAULT_PORT;

  // The executor resolves its target repo from SLOOP_TARGET_REPO; point it at root so the
  // agent edits this project. Only set when unset so an explicit override still wins.
  process.env.SLOOP_TARGET_REPO ??= root;

  const api = await createRealApi(root, process.env);
  const { server, uiMounted } = buildServer({ api, workspaceRoot: root, distDir: DIST_DIR });
  await listen(server, port);

  return {
    url: `http://localhost:${port}`,
    uiMounted,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

async function main(): Promise<void> {
  // Provider keys from a gitignored .env; real shell env still wins. Log key NAMES only.
  const loaded = loadDotEnv();
  if (loaded.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`[sloop] loaded ${loaded.length} var(s) from .env: ${loaded.join(', ')}`);
  }
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const workspace = resolve(process.env.SLOOP_WORKSPACE ?? 'fixtures/sample-workspace');
  const api = await createRealApi(workspace, process.env);
  const { server } = buildServer({ api, workspaceRoot: workspace, distDir: DIST_DIR });
  await listen(server, port);
  // eslint-disable-next-line no-console
  console.log(`sloop server on http://localhost:${port}  workspace=${workspace}`);
}

// Only run main() when invoked directly (tsx src/server/index.ts), not when imported.
const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1] === join(dirname(fileURLToPath(import.meta.url)), 'index.ts');
if (invokedDirectly) {
  void main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[sloop] failed to start:', err);
    process.exit(1);
  });
}
