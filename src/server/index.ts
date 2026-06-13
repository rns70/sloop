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
import { getLogger, configureLogger, resolveLogLevel } from './log';

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
  // Re-read SLOOP_LOG_LEVEL now that .env is loaded (the module-load logger predates it).
  configureLogger({ level: resolveLogLevel(process.env) });
  const root = resolve(opts.root);
  const port = opts.port ?? DEFAULT_PORT;

  // The executor resolves its target (where leaves write code/ and verify runs) from
  // SLOOP_WORKSPACE; point it at root so the agent edits this project even if the process
  // cwd differs. Only set when unset so an explicit override still wins.
  process.env.SLOOP_WORKSPACE ??= root;

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
  const log = configureLogger({ level: resolveLogLevel(process.env) });
  if (loaded.length > 0) {
    log.info(`loaded ${loaded.length} var(s) from .env`, { vars: loaded.join(',') });
  }
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const workspace = resolve(process.env.SLOOP_WORKSPACE ?? 'fixtures/sample-workspace');
  const api = await createRealApi(workspace, process.env);
  const { server } = buildServer({ api, workspaceRoot: workspace, distDir: DIST_DIR });
  await listen(server, port);
  log.info(`server listening on http://localhost:${port}`, { workspace, level: log.level });
}

// Only run main() when invoked directly (tsx src/server/index.ts), not when imported.
const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1] === join(dirname(fileURLToPath(import.meta.url)), 'index.ts');
if (invokedDirectly) {
  void main().catch((err) => {
    getLogger().error('failed to start', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
}
