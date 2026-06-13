// `sloop` CLI dispatcher. Parses argv, then runs the chosen command. Collaborators are
// injected (CliDeps) so the control flow is unit-testable without real IO; main() wires
// the concrete implementations.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './args';
import { scaffold as realScaffold, type ScaffoldResult } from './scaffold';
import { openBrowser as realOpenBrowser } from './openBrowser';
import { setKey as realSetKey, PROVIDER_ENV_VAR, type SetKeyOptions } from './setKey';
import { startServer as realStartServer, type StartedServer } from '../server/index';

const HELP = `sloop — run sloop against the current directory

Usage:
  sloop                 initialize if needed, then serve the UI + API (opens a browser)
  sloop init            scaffold a sloop workspace here (.sloop/, loops/, git)
  sloop set-key [key]   save a provider API key so you needn't export it each run
  sloop --port <n>      serve on a specific port (default 5174)
  sloop --no-open       serve without opening a browser
  sloop --help          show this help
  sloop --version       print the version

set-key:
  Writes the key to a .sloop/.env file (chmod 600) that sloop loads on startup; the real
  shell environment still wins if the var is already set. Pass the key inline, or omit it
  to read from stdin (avoids leaking the key into shell history):
    sloop set-key sk-ant-...                  save ANTHROPIC_API_KEY globally (~/.sloop/.env)
    sloop set-key --provider nebius <key>     save NEBIUS_API_KEY instead
    sloop set-key --local <key>               save to this project's .sloop/.env (overrides global)
    printf %s "$KEY" | sloop set-key          read the key from stdin

Logging:
  SLOOP_LOG_LEVEL=<silent|error|warn|info|debug>  console verbosity (default: info).
                   info streams live cascade progress + agent output; debug adds
                   internal tracing; warn/error/silent progressively quiet it.`;

export interface CliDeps {
  cwd: string;
  scaffold: (root: string) => Promise<ScaffoldResult>;
  isInitialized: (root: string) => Promise<boolean>;
  startServer: (opts: { root: string; port?: number }) => Promise<StartedServer>;
  openBrowser: (url: string) => void;
  /** Persist a provider API key to a `.sloop/.env`; returns the path written. */
  setKey: (opts: SetKeyOptions) => Promise<string>;
  /** Read a secret from stdin (used when `set-key` is given no inline key). */
  readStdin: () => Promise<string>;
  log: (msg: string) => void;
  version: string;
}

/** A dir is "initialized" once it has a .sloop/ directory. */
export async function isInitialized(root: string): Promise<boolean> {
  return fs.access(path.join(root, '.sloop')).then(() => true).catch(() => false);
}

/** Execute the CLI with injected collaborators. */
export async function run(argv: string[], deps: CliDeps): Promise<void> {
  const command = parseArgs(argv);

  switch (command.kind) {
    case 'help':
      deps.log(HELP);
      return;
    case 'version':
      deps.log(deps.version);
      return;
    case 'init': {
      const result = await deps.scaffold(deps.cwd);
      deps.log(
        result.created.length > 0 || result.gitInitialized
          ? `Initialized sloop in ${deps.cwd}`
          : `Already initialized — ${deps.cwd}`,
      );
      return;
    }
    case 'set-key': {
      const value = (command.value ?? (await deps.readStdin())).trim();
      if (!value) {
        throw new Error('no API key provided (pass it inline or pipe it via stdin)');
      }
      const file = await deps.setKey({
        provider: command.provider,
        value,
        scope: command.scope,
        cwd: deps.cwd,
      });
      deps.log(`Saved ${PROVIDER_ENV_VAR[command.provider]} to ${file} (chmod 600).`);
      return;
    }
    case 'serve': {
      if (!(await deps.isInitialized(deps.cwd))) {
        await deps.scaffold(deps.cwd);
        deps.log(`Initialized sloop in ${deps.cwd}`);
      }
      const started = await deps.startServer({ root: deps.cwd, port: command.port });
      if (!started.uiMounted) {
        deps.log('[sloop] UI not built — run `npm run build` to serve the web UI. API is up.');
      }
      if (!process.env.ANTHROPIC_API_KEY && !process.env.NEBIUS_API_KEY) {
        deps.log('[sloop] warning: no ANTHROPIC_API_KEY or NEBIUS_API_KEY set — cascades will fail until one is provided.');
      }
      deps.log(`sloop is running at ${started.url}`);
      if (command.open) deps.openBrowser(started.url);
      return;
    }
  }
}

async function readVersion(): Promise<string> {
  try {
    const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../package.json');
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Read all of stdin as a UTF-8 string (trimmed by the caller). Used for piped secrets. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  await run(process.argv.slice(2), {
    cwd: process.cwd(),
    scaffold: realScaffold,
    isInitialized,
    startServer: realStartServer,
    openBrowser: realOpenBrowser,
    setKey: realSetKey,
    readStdin,
    // eslint-disable-next-line no-console
    log: (msg) => console.log(msg),
    version: await readVersion(),
  });
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1] === path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.ts') ||
  // Launched via bin/sloop launcher (which imports this module; argv[1] points at the bin).
  (process.argv[1] != null && path.basename(process.argv[1]) === 'sloop');
if (invokedDirectly) {
  void main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[sloop]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
