# Handoff — WP-5: Mission Control + Loop page + Libraries (frontend)

> **Stage 2 — parallel. Depends on WP-0 (mock API). Reuses WP-4's design kit (import it; if not merged yet, stub minimal styles and swap later).**

## Before you start
Read the spec (§7 UI surfaces, §3 convergence — the root-status "money shot", §6 roles/templates) and the overview. Branch: `wp-5-mission-control`. Consume `src/web/api-client` + shared types only.

## Your goal
Build the views that make the demo land: the live **loop tree** (Mission Control) with the approval checkpoint, the **Loop page** with streamed agent output, and the **Libraries** view for roles/templates. The root-status flip to `done` ("codebase matches databank") is the visual climax — make it satisfying.

## You own
- `src/web/views/mission-control/` — `CascadeView.tsx`, `LoopTree.tsx`, `LoopNode.tsx`, `Checkpoint.tsx`.
- `src/web/views/loop/` — `LoopPage.tsx`, `OutputStream.tsx`.
- `src/web/views/libraries/` — `Libraries.tsx` (roles + templates lists).
- `src/web/api-client/` — extend the WP-0 stub into the full client if needed (you own its final form).
Do not touch WP-4's `design/`, `shell/`, or `views/databank/` internals — import the kit, don't edit it.

## Tasks
1. `CascadeView` (`/cascades/:id`): `getCascade(id)` for summary + loops; subscribe via `subscribeToCascade(id, onEvent)` and apply `loop-update`/`output` events to local state live.
2. `LoopTree` + `LoopNode`: render the loop forest from the flat list (link by `parent`/`children`). Each node shows role tag (color from role), model chip, status pill, and `delta` tag. Status colors: running/executing, done (green), blocked/failed (red), queued/planned (muted). Cheaper models toward leaves should read naturally.
3. `Checkpoint`: when the root loop is `awaiting_approval`, show the proposed inner/leaf loops with an **Approve & run** button → `approveCascade(id)`. Approving transitions the tree live (the mock emits a scripted event sequence — build against that).
4. `LoopPage` (`/cascades/:id/loops/:loopId`): render the loop as a Notion page — properties (role, model, status, criteria with pass/fail ticks) + body; `OutputStream` shows streamed `output` chunks for that loop.
5. `Libraries`: list roles (`getRoles`) and templates (`getTemplates`) as simple editable-looking cards; the template picker itself lives in the shell (WP-4) but mirror the list here.
6. **The money shot:** when root status becomes `done`, surface a clear, calm success state ("✓ Codebase matches databank") at the top of `CascadeView`. Don't make it gaudy — Notion-quiet, but unmistakable.

## Definition of done
- `npm run dev` → open the fixture cascade: tree renders, checkpoint approves, statuses animate via the mock WS sequence, a loop page streams output, and the root flips to a success state. All from the mock.
- `npm run typecheck` clean.

## Handoff
WP-6 swaps the mock API for the real backend behind `api-client` — keep all data access in `api-client` so that swap is transparent to your components.
