# sloop CLI & `init` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `sloop` CLI that runs sloop against the current working directory, with an `init` command and automatic initialization, serving the API + WebSocket + React UI from one process.

**Architecture:** `cwd` is both the workspace and the agent's target repo. A thin CLI dispatcher (`src/cli/`) handles `init`/serve/help/version and launches a programmatic `startServer({ root, port })` extracted from the server entrypoint. Scaffolding copies a bundled seed (`assets/init-template/`) and runs `git init`. The Express app gains static serving of the Vite build (`dist/web`).

**Tech Stack:** TypeScript (ESM), `tsx` runtime, Express, `ws`, Vitest, `simple-git` (already used by the server), node `child_process` for `git`/browser.

---

## Context the engineer needs

- The server today (`src/server/index.ts`) reads `SLOOP_WORKSPACE` and `PORT` from env, builds either `MockApi` or the real API via `createRealApi(root, env)`, mounts Express routes + a WebSocket upgrade handler for `/api/cascades/:id/stream`, and serves raw workspace files via `/api/files/:relPath`.
- The coding agent's target repo is resolved **from env** inside the executor: `resolveTargetRepo(env) = env.SLOOP_TARGET_REPO || process.cwd()` (`src/server/executor/piExecutor.ts:33`). So to make the agent edit `root`, we set `process.env.SLOOP_TARGET_REPO = root` before constructing the API.
- The workspace root for files/git is passed explicitly: `createRealApi(root, env)` (`src/server/api/real.ts:431`).
- Vite builds the React app to `dist/web` (`vite.config.ts` → `build.outDir: '../../dist/web'`, `root: 'src/web'`), so `dist/web/index.html` is the SPA entry.
- The real API/engine/executor are fully implemented; this plan adds only the CLI, scaffolding, and UI-serving glue.
- Tests are Vitest; the repo runs TypeScript directly via `tsx` (no build step for server code). Existing tests shell out to `git` and use `fs.mkdtemp` (see `src/server/api/real.test.ts`).

## File Structure

| File | Responsibility |
| --- | --- |
| `assets/init-template/.sloop/config.md` | Seed model registry/config (copied from fixtures). |
| `assets/init-template/.sloop/roles/*.md` | Seed role definitions. |
| `assets/init-template/.sloop/templates/*.md` | Seed cascade templates. |
| `assets/init-template/databank/adr-001-example.md` | Starter ADR demonstrating acceptance-criteria format. |
| `src/cli/args.ts` | Pure `parseArgs(argv)` → discriminated command object. |
| `src/cli/args.test.ts` | Tests for arg parsing. |
| `src/cli/scaffold.ts` | `scaffold(root)` — idempotent workspace init + `git init`. |
| `src/cli/scaffold.test.ts` | Tests for scaffolding. |
| `src/cli/openBrowser.ts` | `browserCommand(platform)` + `openBrowser(url)`. |
| `src/cli/openBrowser.test.ts` | Tests for platform command selection. |
| `src/cli/index.ts` | CLI dispatcher: routes commands to scaffold/startServer. |
| `src/cli/index.test.ts` | Tests for command dispatch. |
| `src/server/webui.ts` | `mountWebUi(app, distDir)` — static + SPA fallback. |
| `src/server/webui.test.ts` | Tests for UI mounting / missing-dist behavior. |
| `src/server/buildServer.ts` | `buildServer({ api, workspaceRoot, distDir })` → `http.Server` (extracted route + WS assembly). |
| `src/server/index.ts` | Modify: thin `main()` (env path) + exported `startServer({ root, port })`, both using `buildServer`. |
| `bin/sloop` | Node launcher: registers `tsx`, imports `src/cli/index.ts`. |
| `package.json` | Modify: `bin`, move `tsx` to deps, `files`, `sloop` dev script. |
| `README.md` | Modify: CLI quickstart. |

---

## Task 1: Seed assets (`assets/init-template/`)

**Files:**
- Create: `assets/init-template/.sloop/**`, `assets/init-template/databank/adr-001-example.md`

- [ ] **Step 1: Copy the `.sloop` seed from the existing fixtures**

These are static seed files (config, roles, templates). Copy them verbatim from the sample workspace; this directory becomes the single source of truth for `init` (fixtures stay for evals/mock).

Run:

```bash
mkdir -p assets/init-template/.sloop assets/init-template/databank
cp -R fixtures/sample-workspace/.sloop/config.md assets/init-template/.sloop/config.md
cp -R fixtures/sample-workspace/.sloop/roles assets/init-template/.sloop/roles
cp -R fixtures/sample-workspace/.sloop/templates assets/init-template/.sloop/templates
```

- [ ] **Step 2: Write the starter ADR**

Create `assets/init-template/databank/adr-001-example.md`:

```markdown
---
id: adr-001
title: Example requirement (delete or edit me)
acceptanceCriteria:
  - id: ac-1
    text: "The build passes."
    verify: "npm run build"
    passed: false
---

# ADR-001 — Example requirement

This is a starter ADR. An ADR is a unit of requirement in your databank. sloop diffs
the `databank/` against git HEAD, plans work for what changed, and has a coding agent
implement it in this repo until every criterion's `verify` command exits 0.

## How to use it
1. Replace this file (or add new `adr-NNN-*.md` files) describing what you want built.
2. Give each acceptance criterion a stable `id`, a human `text`, and a concrete `verify`
   shell command that returns exit 0 only when the requirement is met.
3. Open the sloop UI, kick off a cascade, approve it, and watch it converge.

## Notes
- `verify` runs in this repo's root, so commands like `npm test -- <pattern>` work.
- Keep criteria specific and machine-checkable — they are the definition of done.
```

- [ ] **Step 3: Verify the tree**

Run: `find assets/init-template -type f | sort`
Expected: lists `config.md`, the role files, the template files, and `databank/adr-001-example.md`.

- [ ] **Step 4: Commit**

```bash
git add assets/init-template
git commit -m "feat(cli): bundled init seed template"
```

---

## Task 2: Argument parser (`src/cli/args.ts`)

**Files:**
- Create: `src/cli/args.ts`
- Test: `src/cli/args.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/cli/args.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseArgs } from './args';

describe('parseArgs', () => {
  it('defaults to the serve command', () => {
    expect(parseArgs([])).toEqual({ kind: 'serve', port: undefined, open: true });
  });

  it('parses the init command', () => {
    expect(parseArgs(['init'])).toEqual({ kind: 'init' });
  });

  it('parses --port for serve', () => {
    expect(parseArgs(['--port', '8080'])).toEqual({ kind: 'serve', port: 8080, open: true });
  });

  it('parses --no-open for serve', () => {
    expect(parseArgs(['--no-open'])).toEqual({ kind: 'serve', port: undefined, open: false });
  });

  it('treats --help and --version as their own commands', () => {
    expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseArgs(['--version'])).toEqual({ kind: 'version' });
  });

  it('rejects an unknown command', () => {
    expect(() => parseArgs(['frobnicate'])).toThrow(/unknown command/i);
  });

  it('rejects a non-numeric --port', () => {
    expect(() => parseArgs(['--port', 'abc'])).toThrow(/--port/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/args.test.ts`
Expected: FAIL — cannot find module `./args`.

- [ ] **Step 3: Write the implementation**

Create `src/cli/args.ts`:

```ts
// Pure argv parser for the `sloop` CLI. Kept side-effect-free so it is trivially
// testable; the dispatcher (index.ts) turns these commands into actions.

export type Command =
  | { kind: 'serve'; port: number | undefined; open: boolean }
  | { kind: 'init' }
  | { kind: 'help' }
  | { kind: 'version' };

/** Parse process argv (without node + script). Throws on malformed input. */
export function parseArgs(argv: string[]): Command {
  if (argv.includes('--help') || argv.includes('-h')) return { kind: 'help' };
  if (argv.includes('--version') || argv.includes('-v')) return { kind: 'version' };

  const [first] = argv;
  if (first === 'init') return { kind: 'init' };
  if (first !== undefined && !first.startsWith('-')) {
    throw new Error(`unknown command: ${first}`);
  }

  // Default command: serve.
  let port: number | undefined;
  let open = true;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--no-open') {
      open = false;
    } else if (arg === '--port') {
      const raw = argv[i + 1];
      const parsed = Number(raw);
      if (!raw || !Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`--port expects a positive integer, got: ${raw ?? '(missing)'}`);
      }
      port = parsed;
      i += 1;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return { kind: 'serve', port, open };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cli/args.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/cli/args.ts src/cli/args.test.ts
git commit -m "feat(cli): argv parser"
```

---

## Task 3: Scaffold (`src/cli/scaffold.ts`)

**Files:**
- Create: `src/cli/scaffold.ts`
- Test: `src/cli/scaffold.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/cli/scaffold.test.ts`:

```ts
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
    expect(await exists('.sloop/templates/spec-driven.md')).toBe(true);
    expect(await exists('databank/adr-001-example.md')).toBe(true);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/scaffold.test.ts`
Expected: FAIL — cannot find module `./scaffold`.

- [ ] **Step 3: Write the implementation**

Create `src/cli/scaffold.ts`:

```ts
// Idempotent workspace initializer. Copies the bundled seed (assets/init-template)
// into a target dir, ensures a git repo (required for databank diffing), and adds a
// .gitignore entry for transient cascade run state. Never overwrites existing files.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// assets/init-template lives at the repo root, two levels up from src/cli/.
const SEED_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/init-template');

const GITIGNORE_LINE = 'cascades/';

export interface ScaffoldResult {
  /** Workspace-relative paths newly created by this run (excludes ones already present). */
  created: string[];
  /** True iff this run ran `git init` (false if the dir was already a repo). */
  gitInitialized: boolean;
}

/** Initialize `root` as a sloop workspace + target repo. Safe to re-run. */
export async function scaffold(root: string): Promise<ScaffoldResult> {
  const created: string[] = [];

  const gitInitialized = await ensureGitRepo(root);
  await copySeed(SEED_DIR, root, '', created);
  await ensureGitignore(root, created);

  return { created, gitInitialized };
}

/** `git init` only when `.git` is absent. Throws a clear error if git is unavailable. */
async function ensureGitRepo(root: string): Promise<boolean> {
  if (await pathExists(path.join(root, '.git'))) return false;
  try {
    await run('git', ['init', '-q'], { cwd: root });
  } catch (err) {
    throw new Error(
      `sloop needs git to diff the databank, but \`git init\` failed in ${root}. ` +
        `Install git and try again. (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  return true;
}

/** Recursively copy seed → dest, creating only missing files. */
async function copySeed(seedDir: string, destRoot: string, rel: string, created: string[]): Promise<void> {
  const entries = await fs.readdir(path.join(seedDir, rel), { withFileTypes: true });
  for (const entry of entries) {
    const childRel = path.join(rel, entry.name);
    const dest = path.join(destRoot, childRel);
    if (entry.isDirectory()) {
      await fs.mkdir(dest, { recursive: true });
      await copySeed(seedDir, destRoot, childRel, created);
    } else if (!(await pathExists(dest))) {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(path.join(seedDir, childRel), dest);
      created.push(childRel.split(path.sep).join('/'));
    }
  }
}

/** Ensure `.gitignore` contains the cascades line exactly once. */
async function ensureGitignore(root: string, created: string[]): Promise<void> {
  const file = path.join(root, '.gitignore');
  let body = '';
  try {
    body = await fs.readFile(file, 'utf8');
  } catch {
    // No .gitignore yet — we'll create it.
  }
  const lines = body.split('\n').map((l) => l.trim());
  if (lines.includes(GITIGNORE_LINE)) return;

  const prefix = body.length > 0 && !body.endsWith('\n') ? '\n' : '';
  await fs.writeFile(file, `${body}${prefix}${GITIGNORE_LINE}\n`, 'utf8');
  if (body.length === 0) created.push('.gitignore');
}

async function pathExists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true).catch(() => false);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cli/scaffold.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/cli/scaffold.ts src/cli/scaffold.test.ts
git commit -m "feat(cli): idempotent workspace scaffold"
```

---

## Task 4: Browser opener (`src/cli/openBrowser.ts`)

**Files:**
- Create: `src/cli/openBrowser.ts`
- Test: `src/cli/openBrowser.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/cli/openBrowser.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { browserCommand } from './openBrowser';

describe('browserCommand', () => {
  it('uses `open` on macOS', () => {
    expect(browserCommand('darwin', 'http://localhost:5174')).toEqual({
      cmd: 'open',
      args: ['http://localhost:5174'],
    });
  });

  it('uses `xdg-open` on Linux', () => {
    expect(browserCommand('linux', 'http://x')).toEqual({ cmd: 'xdg-open', args: ['http://x'] });
  });

  it('uses cmd start on Windows', () => {
    expect(browserCommand('win32', 'http://x')).toEqual({
      cmd: 'cmd',
      args: ['/c', 'start', '', 'http://x'],
    });
  });

  it('returns null for an unknown platform', () => {
    expect(browserCommand('aix', 'http://x')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/openBrowser.test.ts`
Expected: FAIL — cannot find module `./openBrowser`.

- [ ] **Step 3: Write the implementation**

Create `src/cli/openBrowser.ts`:

```ts
// Open a URL in the default browser. The command selection is a pure function so it can
// be tested without spawning anything; opening itself is best-effort (failure is logged,
// never fatal — the URL is always printed by the caller).

import { spawn } from 'node:child_process';

export interface OpenCommand {
  cmd: string;
  args: string[];
}

/** Map a node `process.platform` to a browser-open command, or null if unsupported. */
export function browserCommand(platform: NodeJS.Platform | string, url: string): OpenCommand | null {
  switch (platform) {
    case 'darwin':
      return { cmd: 'open', args: [url] };
    case 'win32':
      // Empty title arg so a quoted URL isn't treated as the window title.
      return { cmd: 'cmd', args: ['/c', 'start', '', url] };
    case 'linux':
      return { cmd: 'xdg-open', args: [url] };
    default:
      return null;
  }
}

/** Best-effort: launch the browser, swallowing any failure. */
export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): void {
  const command = browserCommand(platform, url);
  if (!command) return;
  try {
    const child = spawn(command.cmd, command.args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Non-fatal: the caller already printed the URL.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cli/openBrowser.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/cli/openBrowser.ts src/cli/openBrowser.test.ts
git commit -m "feat(cli): browser opener"
```

---

## Task 5: Web UI mount (`src/server/webui.ts`)

**Files:**
- Create: `src/server/webui.ts`
- Test: `src/server/webui.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/server/webui.test.ts`:

```ts
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

    const res = await fetch(`${base}/databank/anything`);
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/webui.test.ts`
Expected: FAIL — cannot find module `./webui`.

- [ ] **Step 3: Write the implementation**

Create `src/server/webui.ts`:

```ts
// Static serving of the built React app (Vite output) with an SPA fallback. Mounted by
// buildServer alongside the /api routes on the same port. If the build is missing, this
// is a no-op so the API still serves (the caller logs a build hint).

import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';

/**
 * Serve `distDir` as static assets, falling back to index.html for client-side routes.
 * Returns true if mounted, false if `distDir` has no index.html (nothing mounted).
 */
export function mountWebUi(app: Express, distDir: string): boolean {
  const indexHtml = path.join(distDir, 'index.html');
  if (!existsSync(indexHtml)) return false;

  app.use(express.static(distDir));
  // SPA fallback: anything not handled by /api or a static asset returns index.html.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.sendFile(indexHtml);
  });
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/webui.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/webui.ts src/server/webui.test.ts
git commit -m "feat(server): static SPA serving for the web UI"
```

---

## Task 6: Extract `buildServer` and `startServer` (`src/server/buildServer.ts` + `src/server/index.ts`)

This moves the Express + WebSocket assembly out of `index.ts` into a reusable `buildServer`, then adds a programmatic `startServer({ root, port })`. The env-driven `main()` becomes a thin wrapper. No behavior changes for the existing mock/env path.

**Files:**
- Create: `src/server/buildServer.ts`
- Modify: `src/server/index.ts`
- Test: `src/server/startServer.test.ts`

- [ ] **Step 1: Create `buildServer.ts` (move the assembly out of index.ts)**

Create `src/server/buildServer.ts`:

```ts
// Assembles the sloop HTTP server: /api routes, the /api/files raw-workspace bridge,
// the cascade WebSocket stream, the error funnel, and (optionally) the static web UI.
// Returns a non-listening http.Server so both the env-driven entrypoint (main) and the
// programmatic CLI entry (startServer) share one definition.

import { createServer, type Server } from 'node:http';
import { promises as fs } from 'node:fs';
import { join, normalize, dirname, sep } from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import { WebSocketServer } from 'ws';
import { NotFound as MockNotFound } from './api/mock';
import { NotFound as RealNotFound, type StreamingSloopApi } from './api/real';
import type { SloopApi, CascadeStreamEvent } from './api/contract';
import { mountWebUi } from './webui';

export interface BuildServerOptions {
  api: SloopApi;
  /** Workspace root, for the raw /api/files bridge. */
  workspaceRoot: string;
  /** Built web UI dir; mounted if it contains index.html. */
  distDir?: string;
}

function isNotFound(err: unknown): boolean {
  return err instanceof MockNotFound || err instanceof RealNotFound;
}

function isStreaming(api: SloopApi): api is StreamingSloopApi {
  return typeof (api as Partial<StreamingSloopApi>).subscribe === 'function';
}

/** Build (but do not start) the HTTP server. Returns { server, uiMounted }. */
export function buildServer(opts: BuildServerOptions): { server: Server; uiMounted: boolean } {
  const { api, workspaceRoot, distDir } = opts;

  const safeWorkspacePath = (relPath: string): string => {
    const abs = normalize(join(workspaceRoot, relPath));
    if (abs !== workspaceRoot && !abs.startsWith(workspaceRoot + sep)) {
      throw new RealNotFound(`Path escapes the workspace: ${relPath}`);
    }
    return abs;
  };

  const app = express();
  app.use(express.json({ limit: '4mb' }));

  const h =
    (fn: (req: Request, res: Response) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) => {
      fn(req, res).catch(next);
    };

  app.get('/api/health', (_req, res) => res.json({ ok: true, workspace: workspaceRoot }));

  app.get('/api/adrs', h(async (_req, res) => res.json(await api.listAdrs())));
  app.get('/api/adrs/:relPath/diff', h(async (req, res) =>
    res.json(await api.getAdrDiff(decodeURIComponent(req.params.relPath))),
  ));
  app.get('/api/adrs/:relPath', h(async (req, res) =>
    res.json(await api.getAdr(decodeURIComponent(req.params.relPath))),
  ));
  app.put('/api/adrs/:relPath', h(async (req, res) =>
    res.json(await api.putAdr(decodeURIComponent(req.params.relPath), req.body)),
  ));

  app.get('/api/templates', h(async (_req, res) => res.json(await api.listTemplates())));
  app.get('/api/roles', h(async (_req, res) => res.json(await api.listRoles())));

  app.get('/api/files/:relPath', h(async (req, res) => {
    const rel = decodeURIComponent(req.params.relPath);
    try {
      res.json({ content: await fs.readFile(safeWorkspacePath(rel), 'utf8') });
    } catch {
      throw new RealNotFound(`File not found: ${rel}`);
    }
  }));
  app.put('/api/files/:relPath', h(async (req, res) => {
    const abs = safeWorkspacePath(decodeURIComponent(req.params.relPath));
    await fs.mkdir(dirname(abs), { recursive: true });
    await fs.writeFile(abs, String(req.body?.content ?? ''), 'utf8');
    res.json({ ok: true });
  }));

  app.post('/api/author', h(async (req, res) => res.json(await api.author(req.body))));

  app.get('/api/cascades', h(async (_req, res) => res.json(await api.listCascades())));
  app.post('/api/cascades', h(async (req, res) => res.json(await api.createCascade(req.body))));
  app.get('/api/cascades/:id', h(async (req, res) => res.json(await api.getCascade(req.params.id))));
  app.post('/api/cascades/:id/approve', h(async (req, res) =>
    res.json(await api.approveCascade(req.params.id)),
  ));

  const uiMounted = distDir ? mountWebUi(app, distDir) : false;

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (isNotFound(err)) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'not found' });
      return;
    }
    // eslint-disable-next-line no-console
    console.error('[api] unhandled error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'internal error' });
  });

  const server = createServer(app);

  const STREAM_RE = /^\/api\/cascades\/([^/]+)\/stream$/;
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '', 'http://localhost');
    const match = STREAM_RE.exec(pathname);
    if (!match) {
      socket.destroy();
      return;
    }
    const cascadeId = decodeURIComponent(match[1]);
    wss.handleUpgrade(req, socket, head, (ws) => {
      const sendEvent = (event: CascadeStreamEvent) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
      };
      if (isStreaming(api)) {
        const unsubscribe = api.subscribe(cascadeId, sendEvent, () => ws.close());
        ws.on('close', unsubscribe);
        return;
      }
      void (async () => {
        try {
          const events = await api.streamEvents(cascadeId);
          for (const event of events) {
            if (ws.readyState !== ws.OPEN) break;
            sendEvent(event);
            await new Promise((r) => setTimeout(r, 350));
          }
        } catch (err) {
          sendEvent({ type: 'output', loopId: cascadeId, chunk: `error: ${String(err)}\n` });
        } finally {
          ws.close();
        }
      })();
    });
  });

  return { server, uiMounted };
}
```

- [ ] **Step 2: Rewrite `src/server/index.ts` to use buildServer + export startServer**

Replace the entire contents of `src/server/index.ts` with:

```ts
// sloop backend entrypoint. Two ways in:
//   - main():        env-driven (PORT, SLOOP_WORKSPACE, SLOOP_MOCK) — the npm scripts.
//   - startServer(): programmatic, used by the `sloop` CLI to serve a project dir.
// Both build the same app via buildServer(); only construction + listen differ.

import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import type { Server } from 'node:http';
import { MockApi } from './api/mock';
import { createRealApi } from './api/real';
import type { SloopApi } from './api/contract';
import { buildServer } from './buildServer';

const DEFAULT_PORT = 5174;
// dist/web lives at the repo root, two levels up from src/server/.
const DIST_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist/web');

/** Truthy SLOOP_MOCK selects the mock backend (0/false/no/off = real). */
function useMock(env: NodeJS.ProcessEnv): boolean {
  const raw = env.SLOOP_MOCK;
  if (!raw) return false;
  const v = raw.toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no' && v !== 'off';
}

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
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const workspace = resolve(process.env.SLOOP_WORKSPACE ?? 'fixtures/sample-workspace');
  const mock = useMock(process.env);
  const api: SloopApi = mock ? new MockApi(workspace) : await createRealApi(workspace, process.env);
  const { server } = buildServer({ api, workspaceRoot: workspace, distDir: DIST_DIR });
  await listen(server, port);
  // eslint-disable-next-line no-console
  console.log(
    `sloop server (${mock ? 'mock' : 'real'}) on http://localhost:${port}  workspace=${workspace}`,
  );
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
```

- [ ] **Step 3: Write the startServer smoke test**

Create `src/server/startServer.test.ts`:

```ts
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

  for (const k of ['SLOOP_TARGET_REPO', 'SLOOP_DRY_RUN']) saved[k] = process.env[k];
  process.env.SLOOP_DRY_RUN = '1';
  delete process.env.SLOOP_TARGET_REPO;

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
    const res = await fetch(`${started.url}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; workspace: string };
    expect(body.ok).toBe(true);
    expect(body.workspace).toBe(root);
  });

  it('points the executor target repo at root', () => {
    expect(process.env.SLOOP_TARGET_REPO).toBe(root);
  });
});
```

The test uses a fixed port (`5199`) so `started.url` matches the bound port — `port: 0` would bind an ephemeral port that `started.url` wouldn't reflect.

- [ ] **Step 4: Run the server tests**

Run: `npx vitest run src/server/startServer.test.ts src/server/api/real.test.ts`
Expected: PASS — health + target-repo tests pass, and the existing real API suite is unaffected by the refactor.

- [ ] **Step 5: Commit**

```bash
git add src/server/buildServer.ts src/server/index.ts src/server/startServer.test.ts
git commit -m "refactor(server): extract buildServer + add programmatic startServer"
```

---

## Task 7: CLI dispatcher (`src/cli/index.ts`)

**Files:**
- Create: `src/cli/index.ts`
- Test: `src/cli/index.test.ts`

The dispatcher is kept thin and the side-effecting `run()` takes its collaborators as parameters so it can be tested without starting a real server or opening a browser.

- [ ] **Step 1: Write the failing test**

Create `src/cli/index.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { run, type CliDeps } from './index';

function deps(over: Partial<CliDeps> = {}): CliDeps {
  return {
    cwd: '/proj',
    scaffold: vi.fn(async () => ({ created: ['.sloop/config.md'], gitInitialized: true })),
    isInitialized: vi.fn(async () => true),
    startServer: vi.fn(async () => ({ url: 'http://localhost:5174', uiMounted: true, close: async () => {} })),
    openBrowser: vi.fn(),
    log: vi.fn(),
    version: '9.9.9',
    ...over,
  };
}

describe('run', () => {
  it('init scaffolds and does not start a server', async () => {
    const d = deps();
    await run(['init'], d);
    expect(d.scaffold).toHaveBeenCalledWith('/proj');
    expect(d.startServer).not.toHaveBeenCalled();
  });

  it('serve auto-initializes when uninitialized, then starts + opens', async () => {
    const d = deps({ isInitialized: vi.fn(async () => false) });
    await run([], d);
    expect(d.scaffold).toHaveBeenCalledWith('/proj');
    expect(d.startServer).toHaveBeenCalledWith({ root: '/proj', port: undefined });
    expect(d.openBrowser).toHaveBeenCalledWith('http://localhost:5174');
  });

  it('serve does NOT re-scaffold when already initialized', async () => {
    const d = deps({ isInitialized: vi.fn(async () => true) });
    await run([], d);
    expect(d.scaffold).not.toHaveBeenCalled();
    expect(d.startServer).toHaveBeenCalled();
  });

  it('serve --no-open skips the browser', async () => {
    const d = deps();
    await run(['--no-open'], d);
    expect(d.openBrowser).not.toHaveBeenCalled();
  });

  it('--version logs the version and starts nothing', async () => {
    const d = deps();
    await run(['--version'], d);
    expect(d.log).toHaveBeenCalledWith('9.9.9');
    expect(d.startServer).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/index.test.ts`
Expected: FAIL — cannot find module `./index` export `run`.

- [ ] **Step 3: Write the implementation**

Create `src/cli/index.ts`:

```ts
// `sloop` CLI dispatcher. Parses argv, then runs the chosen command. Collaborators are
// injected (CliDeps) so the control flow is unit-testable without real IO; main() wires
// the concrete implementations.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './args';
import { scaffold as realScaffold, type ScaffoldResult } from './scaffold';
import { openBrowser as realOpenBrowser } from './openBrowser';
import { startServer as realStartServer, type StartedServer } from '../server/index';

const HELP = `sloop — run sloop against the current directory

Usage:
  sloop              initialize if needed, then serve the UI + API (opens a browser)
  sloop init         scaffold a sloop workspace here (.sloop/, databank/, git)
  sloop --port <n>   serve on a specific port (default 5174)
  sloop --no-open    serve without opening a browser
  sloop --help       show this help
  sloop --version    print the version`;

export interface CliDeps {
  cwd: string;
  scaffold: (root: string) => Promise<ScaffoldResult>;
  isInitialized: (root: string) => Promise<boolean>;
  startServer: (opts: { root: string; port?: number }) => Promise<StartedServer>;
  openBrowser: (url: string) => void;
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

async function main(): Promise<void> {
  await run(process.argv.slice(2), {
    cwd: process.cwd(),
    scaffold: realScaffold,
    isInitialized,
    startServer: realStartServer,
    openBrowser: realOpenBrowser,
    // eslint-disable-next-line no-console
    log: (msg) => console.log(msg),
    version: await readVersion(),
  });
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url) ||
  process.argv[1] === path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.ts');
if (invokedDirectly) {
  void main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[sloop]', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/cli/index.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/cli/index.ts src/cli/index.test.ts
git commit -m "feat(cli): command dispatcher with auto-init"
```

---

## Task 8: `bin/sloop` launcher + package.json wiring

**Files:**
- Create: `bin/sloop`
- Modify: `package.json`

- [ ] **Step 1: Create the bin launcher**

Create `bin/sloop`:

```js
#!/usr/bin/env node
// Launcher for the `sloop` CLI. The repo runs TypeScript directly via tsx (no build step
// for server/CLI code), so register the tsx ESM loader and import the TS entry.
import { register } from 'tsx/esm/api';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

register();
const here = dirname(fileURLToPath(import.meta.url));
await import(resolve(here, '../src/cli/index.ts'));
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x bin/sloop`

- [ ] **Step 3: Wire package.json**

Edit `package.json`:

1. Add a `bin` field after `"description"`:

```json
  "bin": {
    "sloop": "bin/sloop"
  },
```

2. Add a `files` field (so a published package ships the runtime pieces):

```json
  "files": [
    "bin",
    "src",
    "assets",
    "dist",
    "vite.config.ts",
    "tsconfig.json"
  ],
```

3. Add a `sloop` dev script to `scripts` (for running from the repo without a global link):

```json
    "sloop": "tsx src/cli/index.ts",
```

4. Move `"tsx": "^4.19.2"` from `devDependencies` to `dependencies` (it is now a runtime dependency of the bin). Remove the line from `devDependencies` and add it under `dependencies`.

- [ ] **Step 4: Verify the version command works through the bin**

Run: `node bin/sloop --version`
Expected: prints `0.0.0` (the current package version).

- [ ] **Step 5: Verify `init` end-to-end in a throwaway dir**

Run:

```bash
TMPDIR_TEST=$(mktemp -d) && (cd "$TMPDIR_TEST" && node "$OLDPWD/bin/sloop" init) && find "$TMPDIR_TEST" -maxdepth 2 -type d | sort && rm -rf "$TMPDIR_TEST"
```

Expected: output includes `.sloop`, `.sloop/roles`, `.sloop/templates`, `databank`, and `.git`.

- [ ] **Step 6: Run the full test suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests PASS, typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add bin/sloop package.json
git commit -m "feat(cli): sloop bin entry + packaging"
```

---

## Task 9: README quickstart

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a CLI quickstart section**

Add this section to `README.md` (place it near the top, after any intro; if `README.md` does not exist, create it with this content under a `# sloop` heading):

````markdown
## Quickstart (CLI)

Run sloop inside any project directory. It treats that directory as both the requirement
databank and the codebase the agent edits.

```bash
# one-time: build the web UI (served by the CLI)
npm install
npm run build

# in your project:
export ANTHROPIC_API_KEY=sk-ant-...     # or NEBIUS_API_KEY
cd /path/to/your/project
sloop init      # scaffold .sloop/, databank/, and a git repo (auto-runs if you skip it)
sloop           # serve the UI + API on http://localhost:5174 and open the browser
```

Then edit an ADR under `databank/`, kick off a cascade in the UI, approve it, and watch
the agent implement and verify it in your repo.

Flags: `sloop --port <n>`, `sloop --no-open`, `sloop --help`, `sloop --version`.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: sloop CLI quickstart"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** single-dir model (Task 6 `startServer` sets `SLOOP_TARGET_REPO=root`, workspace=root); `sloop`/`init`/help/version (Tasks 2, 7); auto-init (Task 7 serve branch); full seed + `git init` (Tasks 1, 3); single-port API+UI serving (Tasks 5, 6); browser open (Tasks 4, 7); error handling — no git (Task 3), no key warning (Task 7), port-in-use surfaces via `listen` error → CLI `main` catch (Task 7), missing `dist` hint (Task 7); packaging (Task 8).
- **Type consistency:** `ScaffoldResult { created, gitInitialized }` (Task 3) is consumed in Task 7; `StartedServer { url, uiMounted, close }` (Task 6) matches the CliDeps signature and test doubles (Task 7); `Command` union (Task 2) drives the `run` switch (Task 7).
- **Port-in-use:** `listen()` rejects on the server `error` event; in `serve` that rejection propagates out of `run` to `main`'s catch, which prints the message and exits 1 — satisfying "fail fast with a clear error."
```
