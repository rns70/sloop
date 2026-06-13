# Handoff — WP-0: Foundation (contracts, mock API, scaffold)

> **Stage 1 — do this ALONE and first. Every other work package is blocked until this merges.**

## Before you start
Read `docs/superpowers/specs/2026-06-13-sloop-design.md` and `docs/superpowers/plans/2026-06-13-sloop-build-overview.md`. The overview contains the canonical contracts you must create verbatim.

## Your goal
Stand up the repo skeleton so five agents can build in parallel: shared types, backend service interfaces, the HTTP/WS API as a **working mock** backed by a sample workspace, the frontend scaffold with an API client stub, and all tooling/scripts. Nothing real needs to run agents yet — but `npm run dev` must serve a Notion-blank app that can fetch mock data.

## You own (create these)
- Root: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `index.html`, `.gitignore`, `.env.example`
- `src/shared/types.ts`, `src/shared/services.ts`, `src/shared/index.ts` (barrel)
- `src/server/api/contract.ts` (route + WS event type definitions), `src/server/api/mock.ts` (mock implementation), `src/server/index.ts` (express + ws server wired to the mock)
- `src/web/api-client/index.ts` (typed client hitting the API; this is a STUB others will extend), `src/web/main.tsx`, `src/web/App.tsx` (blank shell)
- `fixtures/sample-workspace/` — a realistic seed: `databank/adr-007-token-rotation.md` (+1 more), `.sloop/roles/{architect,engineer,qa,security}.md`, `.sloop/templates/{spec-driven,waterfall,tdd}.md`, and one pre-built sample cascade under `cascades/` so Mission Control has something to render.

## Tasks
1. `npm init`, install: `express ws gray-matter simple-git @anthropic-ai/sdk openai`, dev: `typescript tsx vite @vitejs/plugin-react react react-dom tailwindcss postcss autoprefixer vitest @types/{express,ws,react,react-dom,node}`. Add scripts: `dev` (run vite + tsx server concurrently), `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `build`. (`@anthropic-ai/sdk` + `openai` are for WP-2/WP-3's provider clients.)
2. Create `src/shared/types.ts` and `src/shared/services.ts` **exactly** as written in the overview's "Canonical shared contracts" section. Export everything from `src/shared/index.ts`.
3. Create `src/server/api/contract.ts`: a TS type for each endpoint (request/response) and the WS event union, matching the overview's API table.
4. Write `fixtures/sample-workspace/` content. ADRs have frontmatter with stable criterion ids and a `verify` command. The sample cascade includes an `_architect.md` (status `awaiting_approval`) with 2–3 proposed leaf loops. Include `.sloop/config.md` whose frontmatter holds the **model registry** (matching the `ModelRegistry` shared type) with both providers — Anthropic (opus/sonnet/haiku) and **Nebius** (a `nemotron` alias → `nvidia/llama-3.1-nemotron-70b-instruct`, baseUrl `https://api.studio.nebius.ai/v1`, `apiKeyEnv: NEBIUS_API_KEY`). Add a pure `resolveModel` helper in `src/shared/` (typed as `ResolveModel`) plus a unit test. `.env.example` lists `ANTHROPIC_API_KEY` and `NEBIUS_API_KEY`.
5. Create `src/server/api/mock.ts`: an in-memory implementation that reads the fixture workspace on boot and serves every endpoint with real fixture data. The cascade kickoff/approve mutate in-memory state; the WS stream emits a scripted sequence of `loop-update`/`output` events so the frontend can build the live view without a real backend.
6. `src/server/index.ts`: express server mounting the mock for all `/api/*` routes + a `ws` server for `/api/cascades/:id/stream`. Configurable port via env (`PORT`, default 5174).
7. `src/web/api-client/index.ts`: typed functions for each endpoint + a `subscribeToCascade(id, onEvent)` WS helper. Frontend imports ONLY this.
8. `src/web/App.tsx` + `main.tsx`: minimal Tailwind page that calls `getAdrs()` and renders the count, proving the mock works end to end.

## Definition of done
- `npm run typecheck` → no errors.
- `npm run dev` → app loads at localhost, shows data fetched from the mock (e.g. "2 ADRs loaded").
- `curl localhost:5174/api/adrs` returns the fixture ADRs as JSON.
- A short `README.md` section: how to run, and the ownership map (copy from overview).
- Commit on branch `wp-0-foundation`, open for merge.

## Handoff to others
Once merged, `src/shared` is **frozen** — announce it. Backend WPs implement `src/shared/services.ts`; frontend WPs build against `src/web/api-client` + the mock. If anyone needs a contract change, it comes back to a coordinator, not a unilateral edit.
