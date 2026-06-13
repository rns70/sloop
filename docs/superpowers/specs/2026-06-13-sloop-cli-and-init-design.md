# sloop CLI & `init` — Design

**Date:** 2026-06-13
**Status:** Approved (design), pending implementation plan

## Problem

Today sloop runs only as a dev process (`npm run dev` / `npm run start`) wired through
two environment variables: `SLOOP_WORKSPACE` (the databank/config root) and
`SLOOP_TARGET_REPO` (the codebase the agent edits). These are independent and default to
`fixtures/sample-workspace` and `process.cwd()` respectively — which means an unconfigured
run would have the coding agent edit sloop's own source tree.

We want sloop to behave like a normal project-local CLI: run `sloop` inside any project
directory and have it operate on that directory, with an `init` command and automatic
initialization when the directory has not been set up yet.

## Goals

- A `sloop` CLI command that operates on the current working directory.
- `cwd` is **both** the workspace and the target repo (single-dir model).
- `sloop init` scaffolds a ready-to-run workspace.
- Bare `sloop` auto-initializes when the directory is not yet set up, then serves.
- One process serves the API, the WebSocket stream, and the React UI; open the browser.

## Non-goals

- Changing the cascade engine, planner, executor, or git/diff logic.
- Removing the existing env-var driven start path (kept for back-compat, evals, tests).
- Precompiling to `dist/` for the bin (noted as future hardening; the bin runs via `tsx`
  to match the repo's existing convention of running TypeScript directly).
- Multi-project / multi-workspace management.

## Single-dir model

`cwd` becomes both the workspace and the target repo. The CLI sets the existing internal
knobs to `cwd` (`SLOOP_WORKSPACE = cwd`, `SLOOP_TARGET_REPO = cwd`) — or passes the root
explicitly via the new programmatic `startServer({ root })` (see §4). The user sets no
environment variables.

Directory layout after init:

```
my-project/
├─ .sloop/        # config.md, roles/, templates/   (sloop's brain)
├─ databank/      # ADRs — requirements
├─ cascades/      # cascade runs (generated)
├─ src/ …         # the user's code — what the agent writes/edits
└─ .git/
```

Databank diffing filters `git status` to the `databank/` prefix, so the agent's edits to
the user's code and the user's ADR edits coexist in one git repo without interfering.

## Components

### 1. CLI entry — `src/cli/index.ts` (+ `bin/sloop`)

A thin dispatcher over `process.argv`:

| Invocation        | Behavior                                                               |
| ----------------- | --------------------------------------------------------------------- |
| `sloop`           | Ensure initialized (auto-init if `.sloop/` missing), then **serve**.  |
| `sloop init`      | Scaffold only; no server.                                             |
| `sloop --help`    | Usage text.                                                           |
| `sloop --version` | Version from `package.json`.                                          |

Flags: `--port <n>` (overrides `PORT`, default `5174`; binds exactly this port or fails);
`--no-open` (skip launching the browser).

The bin launches the TypeScript entry through `tsx`. `tsx` moves from `devDependencies`
to `dependencies` so a global/linked install works. `bin/sloop` is a small node launcher
with a shebang that registers the `tsx` ESM loader and imports `src/cli/index.ts`.
`package.json` gains `"bin": { "sloop": "bin/sloop" }`.

### 2. Scaffold — `src/cli/scaffold.ts`

`scaffold(root): Promise<ScaffoldResult>` — idempotent. **Only creates missing files;
never overwrites existing ones.** Steps:

1. If `<root>/.git` is absent, run `git init`. If git is not installed, throw a clear
   error (diffing requires git).
2. Copy `.sloop/config.md`, all `roles/`, and all `templates/` from the bundled seed
   directory `assets/init-template/` (see §3).
3. Create `databank/` with one starter ADR — a commented template that demonstrates the
   acceptance-criteria format (each criterion carries a `verify:` shell command).
4. Ensure a `.gitignore` entry for transient cascade run state.

`ScaffoldResult` reports which steps were performed vs. already present so the CLI can
print an accurate summary (e.g. "Initialized sloop in <dir>" vs. "Already initialized").

### 3. Seed assets — `assets/init-template/`

The single source of truth for `init` content. Seeded from today's
`fixtures/sample-workspace/.sloop/` (config + roles + templates), minus sample ADRs and
sample cascades. `fixtures/sample-workspace/` stays unchanged — it remains the fixture
used by the eval harness and the mock backend. The starter ADR template lives here too
(e.g. `assets/init-template/databank/adr-001-example.md`).

### 4. Serving the UI — refactor `src/server/index.ts`

Extract a programmatic entry:

```ts
export async function startServer(opts: { root: string; port?: number }): Promise<{ url: string; close: () => Promise<void> }>;
```

- Builds the real API with `root` as the workspace, sets the executor's target repo to
  `root`, mounts the existing API routes and the WS upgrade handler (unchanged).
- Adds static serving of the Vite build output (`dist/`) with an SPA fallback for
  client-side routes, on the **same port** as the API. If `dist/` is absent, log a clear
  "run `npm run build` to produce the UI" hint (API still serves).
- Returns the resolved URL and a `close()` for tests.

The existing env-driven `main()` becomes a thin wrapper that reads `SLOOP_WORKSPACE` /
`PORT` and calls `startServer`, preserving current behavior and the mock path.

### 5. Browser open

After the server is listening, open the default browser to the URL unless `--no-open` is
set. Platform dispatch via `child_process` (`open` on macOS, `xdg-open` on Linux, `start`
on Windows) — no new dependency. Failure to open is non-fatal (log the URL).

## Data flow

```
sloop (cwd)
  → resolve root = cwd
  → ensure git repo + scaffold if .sloop/ missing
  → startServer({ root, port })
        ├─ real API (workspace = root)
        ├─ executor target repo = root
        ├─ Express: /api/* + WS + static dist/ (SPA fallback)
        └─ listen on port
  → open browser at url
```

## Error handling & edge cases

- **No git installed** (and not a repo): hard error from scaffold with remediation text.
- **No provider key** (`ANTHROPIC_API_KEY` / `NEBIUS_API_KEY`): server starts anyway; print
  a startup warning. Key resolution is fail-fast only when a cascade actually runs.
- **Port in use**: fail fast with a clear error naming the port and the `--port` flag (no
  silent port-hopping, so the opened browser URL always matches the bound port).
- **Scaffold re-run**: fully idempotent; existing files are left untouched.
- **`dist/` missing**: API serves; UI route logs the build hint instead of 500-ing.

## Testing

- `scaffold` unit tests: produces the expected tree; idempotent (second run is a no-op);
  never overwrites an existing file; runs `git init` only when `.git` is absent.
- CLI arg-parsing tests: `init`, default, `--help`, `--version`, `--port`, `--no-open`.
- `startServer` smoke test: `/api/health` responds; an unknown non-`/api` route falls back
  to `index.html` when `dist/` exists.

## Packaging notes

- `tsx` → `dependencies`; add `bin` field; ensure `assets/init-template/` and `dist/` are
  included in the published package `files`.
- `npm run build` must produce `dist/` (Vite) before the served UI works; documented in the
  README quickstart.
