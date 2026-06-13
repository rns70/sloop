# sloop Hackathon Build — Parallel Work Packages & Ordering

This document is the **coordination contract** for building sloop with multiple agents in parallel. Read it together with the spec: `docs/superpowers/specs/2026-06-13-sloop-design.md`.

Each work package (WP) has a self-contained handoff prompt in `handoffs/`. Paste one into a fresh agent. **Every agent reads this overview + the spec first.**

---

## The parallelization strategy

One foundation agent ships the **shared types + a mock API + repo scaffold**. After that merges, five agents build in parallel against those contracts — backend agents implement the real services, frontend agents build against the mock API. A final integration agent swaps mock for real and wires the demo.

```
        ┌─────────────────────────────────────────┐
Stage 1 │  WP-0  Foundation (types, mock API,       │   ← blocks everything; do first, alone
        │        scaffold, sample workspace)         │
        └─────────────────────────────────────────┘
                          │ merge
        ┌─────────────────┼───────────────────────────────────────┐
Stage 2 │  PARALLEL — 5 agents, no shared files                    │
        │                                                          │
        │  Backend (real services)     Frontend (vs mock API)      │
        │  • WP-1 files + git          • WP-4 shell + Databank      │
        │  • WP-2 cascade + planner    • WP-5 MissionControl +      │
        │  • WP-3 executor                    Loop + Libraries      │
        └──────────────────────────────────────────────────────────┘
                          │ all merge
        ┌─────────────────────────────────────────┐
Stage 3 │  WP-6  Integration + demo + polish        │   ← serial, one agent, last
        └─────────────────────────────────────────┘
```

**Why this parallelizes cleanly:** WP-0 defines TypeScript interfaces for every service and a mock implementation of the HTTP/WS API. Backend WPs implement the interfaces; frontend WPs consume the mock. Nobody waits. Integration is mostly "construct real services and pass them to the API layer instead of the mock."

---

## Ordering & dependencies

| Stage | WP | Depends on | Can run alongside |
|-------|----|-----------|--------------------|
| 1 | **WP-0 Foundation** | — | (alone) |
| 2 | **WP-1 Files + Git** | WP-0 | WP-2, WP-3, WP-4, WP-5 |
| 2 | **WP-2 Cascade + Planner** | WP-0 (interfaces only — stubs files/git) | WP-1, WP-3, WP-4, WP-5 |
| 2 | **WP-3 Executor** | WP-0 | WP-1, WP-2, WP-4, WP-5 |
| 2 | **WP-4 Frontend shell + Databank** | WP-0 (mock API) | all Stage-2 |
| 2 | **WP-5 Frontend MissionControl + Loop + Libraries** | WP-0 (mock API) | all Stage-2 |
| 2b | **WP-7 Author assistant (Cursor-style)** | WP-0 (pi-ai) + WP-4 (the `MarkdownEditor`) | WP-5, WP-6 — starts once WP-4's editor merges |
| 3 | **WP-6 Integration + demo** | WP-1…WP-5, WP-7 | (alone) |
| 3 | **WP-8 Eval harness + task suite** | WP-6 (for real numbers; code can be written vs. the `CascadeEngine` interface earlier) | after WP-6 |

If you have fewer than 5 agents: prioritize WP-1 → WP-2 (backend critical path) and WP-4 → WP-5 (frontend), interleaving. WP-3 (executor) can be faked last if time is short — the demo can stub leaf execution.

---

## File ownership map (avoid collisions)

Each WP owns these paths exclusively. **Do not edit files outside your set** (except appending to a clearly-shared barrel only where the handoff says so).

```
src/shared/              WP-0  (frozen after Stage 1 — others import, never edit)
fixtures/sample-workspace/  WP-0
vite/tailwind/tsconfig/package.json  WP-0  (WP-6 may add scripts)

src/server/files/        WP-1
src/server/git/          WP-1
src/server/cascade/      WP-2
src/server/planner/      WP-2
src/server/executor/     WP-3

src/web/design/          WP-4
src/web/shell/           WP-4
src/web/views/databank/  WP-4
src/web/main.tsx         WP-4

src/web/views/mission-control/  WP-5
src/web/views/loop/             WP-5
src/web/views/libraries/        WP-5
src/web/api-client/             WP-5  (replaces WP-0 stub)

src/server/author/       WP-7  (POST /api/author via pi-ai)
src/web/author/          WP-7  (assistant panel + selection toolbar; integrates via MarkdownEditor props, does not edit it)

src/server/api/          WP-0 (contract + mock) → WP-6 (real handlers)
src/server/index.ts      WP-0 (skeleton) → WP-6 (final wiring)

src/eval/                WP-8  (runner, metrics, report)
evals/                   WP-8  (target repos, tasks, results)
```

---

## Canonical shared contracts (the single source of truth)

WP-0 creates these verbatim in `src/shared/`. Every other WP imports from here and never redefines them.

### `src/shared/types.ts`
```ts
export type LoopKind = 'architect' | 'inner' | 'leaf';
export type LoopStatus =
  | 'planned' | 'awaiting_approval' | 'queued'
  | 'executing' | 'blocked' | 'review' | 'done' | 'failed';
export type Delta = 'add' | 'change' | 'delete';

export interface AcceptanceCriterion {
  id: string;
  text: string;
  verify?: string;     // shell command; exit 0 = passed
  passed: boolean;
}

export interface LoopFrontmatter {
  id: string;
  kind: LoopKind;
  role: string;
  model: string;
  status: LoopStatus;
  delta?: Delta;
  parent?: string;
  children: string[];
  sourceAdr?: string;
  template?: string;
  acceptanceCriteria: AcceptanceCriterion[];
  executor?: string;
}

export interface LoopDoc {
  frontmatter: LoopFrontmatter;
  body: string;
  relPath: string;     // path within the workspace, e.g. cascades/<id>/<loop>.md
}

export interface AdrDoc {
  id: string;
  relPath: string;
  title: string;
  body: string;
  acceptanceCriteria: AcceptanceCriterion[];
}

export interface CascadeSummary {
  id: string;
  createdAt: string;            // ISO; pass in, never call Date.now in shared code
  template: string;
  deltas: { add: number; change: number; delete: number };
  rootLoopId: string;
  status: LoopStatus;           // derived from the root loop
}

export interface TemplateDef {
  id: string;
  name: string;
  stages: { name: string; role: string; model: string }[];
  guidance: string;             // prose the architect follows
}

export interface RoleDef {
  id: string;
  name: string;
  defaultModel: string;
  brief: string;
  color?: string;               // tag color in UI
}

export interface DatabankDiff {
  changed: { relPath: string; delta: Delta; before: string; after: string }[];
}

// ---- Model providers (multi-provider: Anthropic + Nebius/Nemotron) ----
export type ProviderName = 'anthropic' | 'nebius';

export interface ModelEntry {
  provider: ProviderName;
  id: string;            // the provider's model id, e.g. 'claude-haiku-4-5-20251001'
                         // or 'nvidia/llama-3.1-nemotron-70b-instruct'
}
export interface ProviderConfig {
  baseUrl?: string;      // nebius: https://api.studio.nebius.ai/v1
  apiKeyEnv: string;     // env var holding the key
}
export interface ModelRegistry {
  models: Record<string, ModelEntry>;        // alias (e.g. 'haiku','nemotron') -> entry
  providers: Record<ProviderName, ProviderConfig>;
}

/** Resolve a loop's `model` alias to a concrete provider + id + key. */
export interface ResolvedModel {
  provider: ProviderName;
  id: string;
  baseUrl?: string;
  apiKey: string;
}

// ---- Authoring assistant (Cursor-style editing of databank docs) ----
export interface AuthorRequest {
  scope: 'selection' | 'doc' | 'multi';
  instruction: string;       // the user's ask
  docPaths: string[];        // current doc; plus extra docs when scope='multi'
  selectionText?: string;    // required when scope='selection'
  model?: string;            // registry alias; falls back to a config default
}
```

### `src/shared/services.ts` (backend internal interfaces)
```ts
import type {
  AdrDoc, LoopDoc, TemplateDef, RoleDef, DatabankDiff, CascadeSummary, LoopStatus,
  ModelRegistry, ResolvedModel,
} from './types';

export interface FilesService {
  listAdrs(): Promise<AdrDoc[]>;
  readAdr(relPath: string): Promise<AdrDoc>;
  writeAdr(doc: AdrDoc): Promise<void>;
  readLoop(relPath: string): Promise<LoopDoc>;
  writeLoop(loop: LoopDoc): Promise<void>;
  listLoops(cascadeId: string): Promise<LoopDoc[]>;
  listTemplates(): Promise<TemplateDef[]>;
  listRoles(): Promise<RoleDef[]>;
  readModelRegistry(): Promise<ModelRegistry>;   // from .sloop/config.md frontmatter
}

/** Pure helper (no I/O): alias + registry + env -> concrete provider/id/key. Lives in src/shared. */
export type ResolveModel = (alias: string, registry: ModelRegistry, env: NodeJS.ProcessEnv) => ResolvedModel;

export interface GitService {
  diffDatabank(): Promise<DatabankDiff>;     // databank working tree vs last commit
  commitAll(message: string): Promise<string>; // returns short sha
}

export interface Executor {
  // Spawns the coding agent for a leaf, streams output, runs verify commands.
  run(loop: LoopDoc, onOutput: (chunk: string) => void): Promise<{ ok: boolean }>;
}

export interface CascadeEngine {
  kickoff(templateId: string): Promise<CascadeSummary>;  // diff → architect proposes tree (awaiting_approval)
  get(cascadeId: string): Promise<{ summary: CascadeSummary; loops: LoopDoc[] }>;
  approve(cascadeId: string): Promise<void>;             // run approved leaves
  recomputeStatus(cascadeId: string): Promise<LoopStatus>; // bubble up the invariant
}
```

### HTTP/WS API (frontend ↔ backend) — implemented as mock by WP-0, real by WP-6
```
GET  /api/adrs                    -> AdrDoc[]
GET  /api/adrs/:relPath           -> AdrDoc
PUT  /api/adrs/:relPath           -> { ok: true }
GET  /api/adrs/:relPath/diff      -> { before: string; after: string }
GET  /api/templates               -> TemplateDef[]
GET  /api/roles                   -> RoleDef[]
GET  /api/files/:relPath          -> { content: string }   // raw markdown of a role/template file
PUT  /api/files/:relPath          -> { ok: true }          body: { content: string }
POST /api/author                  -> { proposal: string }    body: AuthorRequest  (Cursor-style edit; streaming variant optional)
POST /api/cascades                -> CascadeSummary          body: { templateId }
GET  /api/cascades/:id            -> { summary: CascadeSummary; loops: LoopDoc[] }
POST /api/cascades/:id/approve    -> { ok: true }
WS   /api/cascades/:id/stream     -> { type:'loop-update'; loop: LoopDoc }
                                   | { type:'output'; loopId: string; chunk: string }
```

The frontend talks ONLY to this API (via `src/web/api-client`). It never imports backend service code. This is the swap point: mock → real at WP-6.

---

## The demo happy path (what WP-6 must make work end to end)

Edit one ADR → `POST /api/cascades {templateId:'spec-driven'}` → architect proposes a small tree (status `awaiting_approval`) → approve → leaves run Pi agents → `verify` commands pass → statuses bubble up via `recomputeStatus` → root flips to `done` → UI shows "codebase matches databank."

Keep recursion shallow (architect → leaves, optional one inner layer). Only demo criteria that have a `verify` command.

---

## Shared conventions

- **TypeScript everywhere**, ESM, Node 20+. `npm run typecheck` and `npm test` (vitest) must stay green.
- Frontmatter parsing: use `gray-matter`. Git: `simple-git`. Server: `express` + `ws`. Frontend: Vite + React + Tailwind.
- **Model + agent layer: embed [Pi](https://github.com/earendil-works/pi)** — `@earendil-works/pi-ai` (unified multi-provider LLM API; all model calls) and Pi's `agent` package (agent runtime for leaf execution). Nebius/Nemotron is registered via `pi-ai`'s `registerProvider({ api:'openai-completions', baseUrl:'https://api.studio.nebius.ai/v1', apiKey })`. Confirm exact package names/imports at install (`npm view @earendil-works/pi-ai`).
- **No `Date.now()` inside `src/shared`** — pass timestamps in. (Keeps shared logic pure/testable.)
- Each WP commits small and often with conventional commits, on its own branch named `wp-N-shortname`.
- If you discover the contract in `src/shared` is wrong, do NOT edit it unilaterally — flag it; a contract change ripples to every agent.
