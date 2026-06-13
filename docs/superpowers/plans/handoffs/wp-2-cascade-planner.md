# Handoff — WP-2: Cascade engine + architect planner (backend)

> **Stage 2 — parallel. Depends on WP-0. Code against the `FilesService`/`GitService` interfaces (do NOT wait for WP-1 — stub them).**

## Before you start
Read the spec (§3 convergence invariant, §5 cascade lifecycle, §6 templates & routing) and the overview. Branch: `wp-2-cascade-planner`. This is the heart of the product — the convergence invariant lives here.

## Your goal
Implement `CascadeEngine`: turn a databank diff into an architect loop that proposes a tree of role-typed leaf loops (following a template), gate on approval, then evaluate the convergence invariant to bubble status up to the root.

## You own
- `src/server/cascade/` — `cascadeEngine.ts`, `convergence.ts`, tests.
- `src/server/planner/` — `architect.ts` (the big-model call that proposes the tree), `prompt.ts`.
Do not touch `src/shared`, files/git internals, executor, or frontend. Depend only on the `FilesService`/`GitService`/`Executor` **interfaces** from `src/shared/services.ts`; accept them via constructor injection so you can pass fakes in tests.

## Tasks
1. `convergence.ts` — pure functions (no I/O, fully unit-tested):
   - `isLoopDone(loop, byId)`: true iff all `children` are done AND every `acceptanceCriterion.passed`.
   - `recompute(loops)`: given the flat loop list, derive each loop's status bottom-up; return updated loops. A failed/blocked descendant makes ancestors `blocked`. Root status = the tree's status.
2. `prompt.ts` + `architect.ts`: build the architect prompt from the `DatabankDiff` + chosen `TemplateDef` (+ roles), call the planner model **provider-agnostically**, and parse the response into proposed `LoopDoc`s (leaf loops with role, model, `acceptanceCriteria` incl. `verify`, `delta`, `parent` = architect id). Enforce the depth cap (env `SLOOP_MAX_DEPTH`, default 2). Keep the proposed tree small.
   - **Provider resolution:** the planner model alias comes from the cascade/role (default `SLOOP_PLANNER_MODEL`). Resolve it via `FilesService.readModelRegistry()` + the shared `resolveModel` helper → `ResolvedModel`. If `provider === 'anthropic'` use the Anthropic SDK; if `provider === 'nebius'` use an OpenAI-compatible client (`openai` SDK pointed at `resolved.baseUrl`, key from `resolved.apiKey`). This lets the architect plan on e.g. NVIDIA **Nemotron** via Nebius as easily as on Claude. Keep the two clients behind one `callModel(resolved, messages)` function so the rest of the planner is provider-blind.
3. `cascadeEngine.ts` — implement `CascadeEngine`:
   - `kickoff(templateId)`: `git.diffDatabank()` → run architect → write `_cascade.md` + `_architect.md` + proposed leaf loops via `files.writeLoop` with status `awaiting_approval`/`planned`. Return `CascadeSummary`.
   - `get(cascadeId)`: load summary + loops via `files.listLoops`.
   - `approve(cascadeId)`: flip proposed loops to `queued`, then for each leaf call the injected `Executor.run`, update `passed`/status, persist, and after each call `recompute`.
   - `recomputeStatus(cascadeId)`: load loops, run `convergence.recompute`, persist, return root status.
4. Tests: convergence math (a child failing blocks the root; all-pass → root done) with hand-built loop lists; `kickoff` with a fake git diff + fake architect returns a tree; `approve` with a fake Executor that passes/fails drives root to `done`/`blocked`.

## Reference for the model call
Before writing `architect.ts`, consult the `claude-api` skill for current model ids and SDK usage. Do not hardcode a guessed model string.

## Definition of done
- `npm run typecheck` clean; `npm test` green, including convergence edge cases.
- `createCascadeEngine({ files, git, executor })` factory exported for WP-6.

## Handoff
WP-6 wires real WP-1 services + WP-3 executor into your factory. Your convergence functions are the demo's money shot — make them correct and well-tested.
