# Handoff — WP-7: Author assistant (Cursor-style editing of databank docs)

> **Stage 2b — starts once WP-4's `MarkdownEditor` merges. Depends on WP-0 (pi-ai) + WP-4. Runs alongside WP-5/WP-6.**

## Before you start
Read the spec (**§7.1 Authoring assistant**, §6.3 model routing) and the build overview. Open the mockups in `docs/superpowers/mockups/`. Branch: `wp-7-author-assistant`. This is the AI-authoring side of sloop — editing the *requirements*, distinct from cascades which reconcile code.

## Your goal
Add a Cursor-style assistant to the databank editor: select text and ask to change it, or chat with the current doc (and, wider, multiple docs). Every proposed change is shown as an **inline diff** the user accepts or rejects — never a silent write. All model calls go through `pi-ai`, so any provider (incl. Nemotron) works.

## You own
- `src/server/author/` — `authorService.ts` (the `POST /api/author` handler logic) + tests.
- `src/web/author/` — `AssistantPanel.tsx` (doc/multi-doc chat), `SelectionToolbar.tsx` (the "ask to change selection" affordance), `useAuthor.ts` (calls the API).
Do NOT edit WP-4's `MarkdownEditor` — integrate through the hooks it exposes (`onSelectionChange`, `applyProposal`/`proposal`). Do not touch other WPs' files. Depend on shared types + `pi-ai` + WP-4's exported editor component/kit.

## Tasks
1. `authorService.ts`: implement the logic behind `POST /api/author` (body = `AuthorRequest` from shared types). Load the referenced `docPaths` via `FilesService` (inject the interface), build a prompt for the scope:
   - `selection` → "rewrite this selection per the instruction; return only the replacement markdown."
   - `doc` → instruction applied to the whole current doc; return the edited doc (or a chat answer).
   - `multi` → same with several docs concatenated as context.
   Resolve the model (`AuthorRequest.model` → registry → default) and call `pi-ai`. Return `{ proposal: string }`. (Streaming is optional; ship non-streaming first.)
2. `useAuthor.ts`: typed client calling `POST /api/author` (extend `api-client` if needed, coordinating the surface with WP-5 who owns `api-client`'s final form — add your function, don't rewrite theirs).
3. `SelectionToolbar.tsx`: subscribe to `MarkdownEditor`'s `onSelectionChange`; when there's a selection, show a small "Ask to change…" input; on submit call `useAuthor({scope:'selection', selectionText, docPaths:[current]})`, then `editor.applyProposal(selectionText, proposal)` so it renders as an inline diff to accept/reject.
4. `AssistantPanel.tsx`: a quiet right-hand panel (Notion-minimal, matches the mockups) for `scope:'doc'`/`'multi'` — a doc-context chip list (add other databank docs for wide context), an instruction box, and results; doc-edit results applied via the same inline-diff accept/reject flow.
5. Tests: `authorService` with a fake `FilesService` + a stubbed `pi-ai` call returns a `proposal` for each scope; selection prompt includes the selected text; multi includes all `docPaths`.

## Scope guidance (hackathon)
Ship in this order; stop when time runs out: **(1) selection edit** is the must-have demo moment (reuses inline diff, highest wow), then **(2) doc chat**, then **(3) multi-doc wide context**. Don't build streaming, history, or multi-turn memory unless the first three are solid.

## Definition of done
- `npm run typecheck` clean; `npm test` green for your files.
- Against the mock (or real) backend: select text → ask → inline diff appears → accept updates the doc. Document any `api-client` addition you made for WP-5/WP-6.

## Handoff
WP-6 wires the real `POST /api/author` (pi-ai) and confirms the selection→diff→accept loop end to end. The narrative win for the demo: edit a requirement with the assistant, then run a cascade to reconcile the code.
