# Handoff — WP-4: Frontend shell + design system + Databank view

> **Stage 2 — parallel. Depends on WP-0 (mock API). Build entirely against the mock; never import backend code.**

## Before you start
Read the spec (§7 UI surfaces — Notion aesthetic) and the overview. Branch: `wp-4-frontend-shell`. You consume `src/web/api-client` and shared types only.

## Your goal
Establish the Notion-style design system + app shell, and build the **Databank view**: browse ADRs and edit one with an inline diff. This sets the visual language WP-5 reuses, so nail the aesthetic: clean, light, typographic, generous whitespace, subtle borders, small uppercase labels, rounded tags.

## You own
- `src/web/design/` — Tailwind theme tokens + primitives: `Tag`, `Card`, `PropertyRow`, `Button`, `Label`, `Page` layout. Export a small component kit WP-5 imports.
- `src/web/shell/` — `AppShell.tsx` (left sidebar: Databank / Cascades / Libraries; top bar), routing (`react-router`).
- `src/web/views/databank/` — `DatabankList.tsx`, `AdrEditor.tsx`, `InlineDiff.tsx`.
- `src/web/main.tsx` (finalize).
Do not touch `src/web/views/{mission-control,loop,libraries}` (WP-5) or `src/web/api-client` internals (extend only via the documented surface; if you need a new client call, add it and tell WP-5/WP-6).

## Tasks
1. Tailwind theme: Notion-like palette (paper white, warm grays `#37352f`/`#787774`/`#9b9a97`, subtle `#ededec` borders), system font stack, tag color tokens for roles.
2. Design primitives in `src/web/design/` — keep them dumb/presentational. This is the kit; WP-5 must be able to render the loop tree with it.
3. `AppShell` with sidebar nav + routed content area. Sidebar sections match the spec (Databank, Cascades, Libraries).
4. Databank view:
   - `DatabankList` → `getAdrs()`, list with title + criteria count.
   - `AdrEditor` → `getAdr(relPath)`, editable markdown textarea, Save → `putAdr`. Show acceptance criteria (id, text, verify) as a clean list.
   - `InlineDiff` → `getAdrDiff(relPath)`, render before/after as a simple added/removed line diff (green/red), Notion-quiet styling.
5. A "Kick off cascade" affordance in the shell/top bar (template picker dropdown from `getTemplates()`), calling `createCascade({templateId})` then routing to `/cascades/:id` (the view itself is WP-5 — just navigate; a placeholder is fine if WP-5 isn't merged yet).

## Definition of done
- `npm run dev` → shell renders, Databank lists fixture ADRs, opening one shows the editor + criteria, diff renders. All from the mock.
- `npm run typecheck` clean.
- The design kit is documented (a short list of exported components) so WP-5 can reuse it without re-styling.

## Handoff
WP-5 imports your `src/web/design` kit and the `AppShell`. Keep the kit stable and announce it when merged.
