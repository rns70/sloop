# Handoff — WP-4: Frontend shell + design system + Databank view

> **Stage 2 — parallel. Depends on WP-0 (mock API). Build entirely against the mock; never import backend code.**

## Before you start
Read the spec (§7 UI surfaces — Notion aesthetic) and the overview. **Open the approved mockups in `docs/superpowers/mockups/` (especially `markdown-editor-and-roles.html`) — they are the visual target; build to them, and follow the locked visual-language note in that folder's README.** Branch: `wp-4-frontend-shell`. You consume `src/web/api-client` and shared types only.

## Your goal
Establish the Notion-style design system + app shell, and build the **Databank view**: browse ADRs and edit one with an inline diff. This sets the visual language WP-5 reuses, so nail the aesthetic: clean, light, typographic, generous whitespace, subtle borders, small uppercase labels, rounded tags.

## You own
- `src/web/design/` — Tailwind theme tokens + primitives: `Tag`, `Card`, `PropertyRow`, `Button`, `Label`, `Page` layout, and `MarkdownEditor` (the BlockNote wrapper, below). Export a small component kit WP-5 imports.
- `src/web/shell/` — `AppShell.tsx` (left sidebar: Databank / Cascades / Libraries; top bar), routing (`react-router`).
- `src/web/views/databank/` — `DatabankList.tsx`, `AdrEditor.tsx`, `InlineDiff.tsx`.
- `src/web/main.tsx` (finalize).
Do not touch `src/web/views/{mission-control,loop,libraries}` (WP-5) or `src/web/api-client` internals (extend only via the documented surface; if you need a new client call, add it and tell WP-5/WP-6).

## Tasks
1. Tailwind theme: Notion-like palette (paper white, warm grays `#37352f`/`#787774`/`#9b9a97`, subtle `#ededec` borders), system font stack, tag color tokens for roles.
2. Design primitives in `src/web/design/` — keep them dumb/presentational. This is the kit; WP-5 must be able to render the loop tree with it.
3. `AppShell` with sidebar nav + routed content area. Sidebar sections match the spec (Databank, Cascades, Libraries). **Navigation is the left sidebar only — no top tabs.** The content top bar is just a quiet breadcrumb (e.g. `Cascades / requirements-sync`) + minor right-aligned context. See the mockups (below).
4. `MarkdownEditor` (in `src/web/design/`) — wrap **BlockNote** (`@blocknote/core`, `@blocknote/react`, `@blocknote/mantine`), a block-based rich-text editor, NOT a textarea:
   - Create the editor with `useCreateBlockNote()`; render with `<BlockNoteView editor={editor} theme="light" />` from `@blocknote/mantine`. Import its CSS: `@blocknote/core/fonts/inter.css` and `@blocknote/mantine/style.css`.
   - Props: `value: string` (markdown in) + `onChange(markdown: string)` + optional `diffAgainst?: string` (previous markdown). On mount/`value` change, load via `await editor.tryParseMarkdownToBlocks(value)` → `editor.replaceBlocks(...)`. On edit, export with `await editor.blocksToMarkdownLossy(editor.document)` and call `onChange`.
   - **Inline-diff mode:** when `diffAgainst` is set, render a read-only view that shows adds/removes **inline within the document flow** (added text/blocks with a green left accent, removed with red strikethrough) — NOT a separate side rail. A simple line/block-level diff of the two markdown strings is fine for the hackathon.
   - **This is the shared core primitive.** It is reused for ADRs (WP-4) and for role/template files (WP-5) — keep it file-agnostic: it edits whatever markdown string it's given. The markdown export is lossy, so callers that have frontmatter (ADRs, roles) pass only the body and recombine frontmatter on save.
   - Scope BlockNote/Mantine styles to the editor container so they don't fight the Tailwind Notion theme elsewhere.
5. Databank view (each ADR is a plain markdown file):
   - `DatabankList` → `getAdrs()`, list with title + criteria count.
   - `AdrEditor` → `getAdr(relPath)`, render the body in `MarkdownEditor`, Save → `putAdr` (recombining edited body with the untouched frontmatter/criteria). A "showing changes / edit" toggle: in changes mode, pass `diffAgainst` (from `getAdrDiff`) so the edit surfaces **inline diffs in-document**. Show acceptance criteria (id, text, verify) as a clean list.
   - `InlineDiff` is the diff renderer used by `MarkdownEditor`'s diff mode (inline, in-document) — not a separate panel.
   - `InlineDiff` → `getAdrDiff(relPath)`, render before/after as a simple added/removed line diff (green/red), Notion-quiet styling.
6. A "Kick off cascade" affordance in the shell/top bar (template picker dropdown from `getTemplates()`), calling `createCascade({templateId})` then routing to `/cascades/:id` (the view itself is WP-5 — just navigate; a placeholder is fine if WP-5 isn't merged yet).

## Definition of done
- `npm run dev` → shell renders, Databank lists fixture ADRs, opening one shows the editor + criteria, diff renders. All from the mock.
- `npm run typecheck` clean.
- The design kit is documented (a short list of exported components) so WP-5 can reuse it without re-styling.

## Handoff
WP-5 imports your `src/web/design` kit and the `AppShell`. Keep the kit stable and announce it when merged.
