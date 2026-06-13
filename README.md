# sloop

**An IDE for agent factories** — a local app that keeps a codebase continuously
reconciled to a databank of requirement documents (ADRs). Edit your requirements, kick
off a **cascade**, and a tree of agent loops drives the code back into agreement. When
the root loop reports **done**, the codebase matches the databank.

See the design and build plan:
- `docs/superpowers/specs/2026-06-13-sloop-design.md`
- `docs/superpowers/plans/2026-06-13-sloop-build-overview.md`

> **Status:** WP-0 (Foundation) — shared contracts, a working **mock** API over a sample
> workspace, and the frontend/backend scaffold. No real git, agents, or backend logic yet.

---

## Run it

Requires **Node 20+**.

```bash
npm install
cp .env.example .env      # optional; fill in keys only when WP-2/WP-3 land
npm run dev               # Vite app on :5173, mock API on :5174 (concurrently)
```

Open **http://localhost:5173** — the page loads ADRs through the api-client and renders
"2 ADRs loaded from the mock."

Verify the API directly:

```bash
curl localhost:5174/api/adrs        # the two fixture ADRs as JSON
curl localhost:5174/api/health      # { ok, workspace }
```

### Scripts
| Script | Does |
|--------|------|
| `npm run dev` | Vite web app + `tsx` mock server, concurrently |
| `npm run typecheck` | `tsc --noEmit` across the whole repo |
| `npm test` | Vitest (currently the `resolveModel` unit tests) |
| `npm run build` | Typecheck + Vite production build |
| `npm run start` | Mock server only (`tsx src/server/index.ts`) |

Ports and the workspace path are configurable via env: `PORT` (5174), `PORT_WEB` (5173),
`SLOOP_WORKSPACE` (defaults to `fixtures/sample-workspace`).

---

## How it's wired

```
src/web  ──HTTP/WS──▶  src/server/api  ──▶  mock (WP-0)  ──reads──▶  fixtures/sample-workspace
   │                        ▲                  swap point
   └─ api-client            └─ contract.ts (SloopApi) ──▶ real services (WP-6)
```

The web app talks **only** to `src/web/api-client`, which hits the API defined in
`src/server/api/contract.ts`. WP-0 satisfies that contract with an in-memory **mock**
that reads the sample workspace; WP-6 swaps in real handlers backed by the services in
`src/shared/services.ts`. Nothing else changes at the swap.

`src/shared` holds the **canonical, frozen contracts** — every work package imports from
here and never redefines them.

---

## File ownership map

Each work package owns its paths exclusively. **Do not edit files outside your set.**

```
src/shared/                          WP-0  (FROZEN after Stage 1 — import, never edit)
fixtures/sample-workspace/           WP-0
package.json / tsconfig* / vite / tailwind / postcss   WP-0  (WP-6 may add scripts)

src/server/files/                    WP-1
src/server/git/                      WP-1
src/server/cascade/                  WP-2
src/server/planner/                  WP-2
src/server/executor/                 WP-3

src/web/design/                      WP-4
src/web/shell/                       WP-4
src/web/views/databank/              WP-4
src/web/main.tsx                     WP-4

src/web/views/mission-control/       WP-5
src/web/views/loop/                  WP-5
src/web/views/libraries/             WP-5
src/web/api-client/                  WP-5  (replaces the WP-0 stub)

src/server/api/                      WP-0 (contract + mock) → WP-6 (real handlers)
src/server/index.ts                  WP-0 (skeleton)        → WP-6 (final wiring)
```

---

## Model + agent layer: Pi (for WP-2 / WP-3)

sloop embeds **[Pi](https://github.com/earendil-works/pi)** (`earendil-works`, MIT) for
all model calls and agent execution — no direct Anthropic/OpenAI SDKs. Confirmed package
names at install (versions pinned to `^0.79.3`, already in `package.json`):

| Package | Role |
|---------|------|
| **`@earendil-works/pi-ai`** | Unified multi-provider LLM API. All model calls (architect planning + leaf execution). Anthropic & OpenAI built in; **Nebius/Nemotron** registers as an OpenAI-compatible provider via `registerProvider({ api: 'openai-completions', baseUrl: 'https://api.studio.nebius.ai/v1', apiKey })`. |
| **`@earendil-works/pi-agent-core`** | General-purpose agent runtime (transport abstraction, tool-calling, state). The substrate for the Executor. |
| **`@earendil-works/pi-coding-agent`** | Coding-agent CLI/SDK with read/bash/edit/write tools + session management. Best fit for the **leaf Executor** (WP-3): run a coding agent against the target repo on the leaf's resolved model. |

**Model registry** lives in `fixtures/sample-workspace/.sloop/config.md` frontmatter
(shape = `ModelRegistry` in `src/shared/types.ts`): aliases `opus`/`sonnet`/`haiku`
(Anthropic) and `nemotron` (Nebius → `nvidia/llama-3.1-nemotron-70b-instruct`). The pure
`resolveModel(alias, registry, env)` helper (`src/shared/resolveModel.ts`) turns an alias
into a concrete `{ provider, id, baseUrl?, apiKey }`. Keys come from `ANTHROPIC_API_KEY`
and `NEBIUS_API_KEY` (see `.env.example`).

---

## Conventions

- TypeScript everywhere, ESM, Node 20+. Keep `npm run typecheck` and `npm test` green.
- Frontmatter: `gray-matter`. Git: `simple-git`. Server: `express` + `ws`. Web: Vite + React + Tailwind.
- **All workspace frontmatter keys are camelCase**, matching the shared TS interfaces
  exactly (`acceptanceCriteria`, `sourceAdr`, …) — `gray-matter` parses straight into the
  types with no remapping.
- **No `Date.now()` in `src/shared`** — pass timestamps in (keeps shared logic pure).
- Branch per WP (`wp-N-shortname`), small conventional commits.
- **`src/shared` is frozen after WP-0 merges.** If a contract is wrong, flag it to the
  coordinator — do not edit it unilaterally; it ripples to every other agent.
