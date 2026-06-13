# Global Assistant — Design

**Date:** 2026-06-13
**Status:** Approved (brainstorming) — ready for implementation planning

## Problem

Today's assistant (`src/web/author/AssistantPanel.tsx`) is doc-scoped: it lives *inside*
the ADR editor, only knows the open databank doc (plus optionally attached sibling docs),
and only does "Edit doc" / "Ask". Creating new artifacts (ADRs, roles, templates) is a
separate, deterministic sidebar flow (`src/web/shell/createItem.ts`) the assistant can't
reach. There is no provider/model picker in the UI — the request carries an optional model
alias resolved server-side.

We want one assistant that:

1. Is **global** — a persistent right rail available on every view, not buried in the editor.
2. Can **create** new databank docs and role/template files, not just edit the open one.
3. Lets the user **choose the model** (from the aliases configured in `.sloop/config.md`).

## Decisions (from brainstorming)

- **Write model:** Always preview + confirm. Every assistant action becomes a structured
  proposal the user approves before anything is written to disk. Preserves the existing
  "never silently writes" invariant.
- **Surface:** Persistent, collapsible right rail, present across databank / libraries / cascades.
- **Model picker:** Pick from configured aliases (single source of truth = `.sloop/config.md`),
  each labeled with its provider + concrete model id. No new config surface.
- **Intent:** Model infers the action and returns a typed proposal; the user confirms type +
  path before write. The preview gate makes occasional misclassification harmless.
- **Mechanism:** Single structured model call returning a delimited envelope, parsed server-side
  into a typed proposal (Approach A). One call = one cost, one latency. Stateless — no
  server-side conversation state.
- **Conversation:** Single-shot per action (instruction → proposal → confirm) with a small
  running result log in the rail. Not a multi-turn chat.

## Architecture

### 1. Contract & shared types

`src/server/api/contract.ts`, `src/shared/types.ts`:

- **`GET /api/models` → `ModelOption[]`**, `ModelOption = { alias: string; provider: ProviderName; id: string }`.
  Derived from the registry server-side. **No API keys leave the server.** Feeds the picker.
- **`POST /api/assistant` → `AssistantProposal`**, body `AssistantRequest`. This generalizes
  today's `POST /api/author`. The only caller of `/api/author` is the panel being replaced, so
  `/api/author` is **migrated** (renamed), not kept in parallel.

```ts
interface AssistantRequest {
  instruction: string;
  contextPaths: string[];   // docs loaded as context (current doc auto-included; user can attach more)
  model?: string;           // registry alias from the picker
}

type AssistantAction = 'answer' | 'edit' | 'create-adr' | 'create-role' | 'create-template';

interface AssistantProposal {
  action: AssistantAction;
  summary: string;          // one-line human description, shown above the preview
  targetPath?: string;      // edit: doc to change; create-*: proposed path (client re-uniquifies — see Collision safety)
  title?: string;           // create-adr: proposed ADR title
  content: string;          // answer text | full edited markdown | full new-file content
}
```

### 2. Server — `assistantService` (generalize `authorService`)

`src/server/author/` → reworked into the assistant service (keep the module, rename concepts).

- Keeps the injectable `call` seam, `resolveModel`, `toPiModel`, and per-call registry read
  (so a hot-edited `.sloop/config.md` takes effect without restart).
- **Prompt:** one system prompt describing the five actions and the on-disk shapes
  (ADR = title + markdown body; role/template = frontmatter + body), mandating the envelope:

  ```
  <action>create-role</action>
  <path>.sloop/roles/security-reviewer.md</path>
  <content>…full file content…</content>
  ```

- **Envelope parser** (new, pure, no I/O, unit-testable): tolerant — missing/garbled envelope →
  `{ action: 'answer', content: <raw output> }`. Validates `action` against the allowed set;
  unknown action → `answer`. Extracts `summary`/`title` when present, else derives a reasonable default.
- Loads `contextPaths` like today's `loadDocs` (fail-soft per doc — a doc that can't be read
  is skipped, not fatal).
- Fail-fast: empty instruction or empty resulting content throws (matches existing style).

### 3. Web — global assistant

- **`AssistantContext`** (new, app-level provider, mounted in `AppShell`): holds run state and an
  optional registration the open editor makes — `{ openDocPath, applyInlineProposal(original, replacement) }`.
  This lets the shell-level rail hand an **edit to the currently-open doc** back to the editor's
  existing inline accept/reject diff. Edits to a *non-open* doc, and all creates, preview in the rail.
- **`AssistantRail`** (new, `src/web/shell`, rendered in `AppShell` as the persistent collapsible
  right rail):
  - Model picker populated from `GET /api/models`; selected alias passed as `model`.
  - Context chips: auto-includes the current doc (if a doc view is open); "attach" adds from all
    databank docs / roles / templates.
  - Instruction box + submit. Renders the typed proposal:
    - `answer` → text block in the rail.
    - `edit` (open doc) → routes through `applyInlineProposal` (inline diff in the editor).
    - `edit` (other doc) → diff preview + **Apply** → `putAdr`.
    - `create-adr` → preview (title + body) + **Create** → construct `AdrDoc`, `putAdr`, route to it.
    - `create-role` / `create-template` → raw file preview + **Create** → `putFile`, route to it.
- **Collision safety:** before any create write, the rail runs the proposed slug through a small
  `slugify`/`uniqueSlug` helper against the live id/path set — the model proposes a name, the
  client guarantees uniqueness.
- **`AdrEditor`**: registers its open doc + `applyProposal` handle with `AssistantContext` so the
  rail can route an edit of the open doc through the editor's inline diff. The pre-existing (and
  currently orphaned) `src/web/author/*` assistant stack is removed as part of the migration.

### 4. Error handling

- Empty instruction → submit disabled.
- Model / registry / network error → existing inline error line in the rail.
- Unparseable model output → treated as `answer` (never a silent bad write).
- Create / edit write failure → surfaced, no navigation; the proposal stays so the user can retry.
- Empty registry → disabled picker + a hint to configure `.sloop/config.md`.

### 5. Testing

- **Server:** `assistantService` per-action with an injected fake `call` — each action parses
  correctly; garbled envelope → `answer`; empty content throws. Envelope parser has its own pure
  unit tests. `GET /api/models` maps registry → options without leaking keys.
- **Web:** rail lists aliases; each proposal type renders the correct preview; confirm calls the
  correct write (`putAdr` / `putFile`); collision → unique slug; open-doc edit routes through the
  inline-diff callback.
- Existing `/api/author` tests migrate to `/api/assistant`.

## Out of scope (v1, YAGNI)

- Threaded / multi-turn chat and any server-side conversation history.
- Acceptance-criteria generation for created ADRs (created with `acceptanceCriteria: []`).
- The selection-scope inline rewrite (may return later as an in-editor affordance).
