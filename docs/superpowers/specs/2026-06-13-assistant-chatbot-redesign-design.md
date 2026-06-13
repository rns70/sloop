# Assistant Chatbot Redesign — Design

**Date:** 2026-06-13
**Branch:** `assistant-chatbot` (worktree off `dev-jelle` tip `c344169`)
**Status:** Approved design — ready for implementation plan
**Supersedes:** `2026-06-13-global-assistant-design.md` (v1 single-shot assistant)

## Problem

The v1 global assistant shipped as **single-shot, stateless, confirm-first**: one
instruction → the server parses one model turn into a typed `AssistantProposal` via a
text envelope → the rail previews it → the user clicks Apply/Discard → the client writes
the file. It does not converse, does not stream, and gates every write behind manual
confirmation.

The ask is to make it behave like a chat bot (Claude.ai / Copilot): a streaming,
multi-turn conversation where the assistant **acts directly** on the databank. This
inverts all three pillars of v1, so it is a redesign — not an extension of the
single-shot path.

## Decisions (locked)

1. **Native pi-ai tool-calling.** `@earendil-works/pi-ai` natively supports tools
   (`Context.tools`, `ToolCall`, `ToolResultMessage`, streaming `toolcall_*` events,
   `stopReason: "toolUse"`). The server runs a real agent loop instead of parsing a text
   envelope. `envelope.ts`/`parseEnvelope` and the single-shot `assistantService` are retired.
2. **Auto-apply writes (no confirm gate).** Tools write to the working tree immediately,
   server-side. The existing "Showing changes" / `getAdrDiff` view + git are the safety net.
3. **Streaming + multi-turn.** Token-by-token SSE; the client holds the full conversation
   thread and sends complete history each turn (server stays stateless).
4. **Agent has read/search reach.** Read-only `list_docs` / `read_doc` / `search` tools
   alongside the write tools, so it can locate a doc by description, read it, then edit.
5. **Chat lives in the right rail, widened** (~320→380px); `AssistantRail` rebuilt as a
   chat thread. No full-screen route.
6. **No in-app revert affordance.** Rely on the existing diff view + git. Can add later.

### Defaults taken (YAGNI)

- **Ephemeral conversation** — thread lives in client memory, lost on page reload. No
  persistence layer.
- **No thinking-token display** — stream visible text only; `thinking_*` events ignored.

## Architecture

```
Client (AssistantRail chat thread)
  │  POST /api/assistant/stream  { messages: ChatMessage[], model }
  ▼
SSE endpoint (buildServer.ts)
  │  → runAssistantAgent(messages, modelAlias, deps)   [src/server/assistant/agent.ts]
  │      loop: pi stream() → forward text deltas
  │            on toolUse → toolExecutor.run(call)      [src/server/assistant/tools.ts]
  │                         (read-only OR auto-apply write via files service)
  │            append assistant + toolResult messages, repeat until stop / max-iter
  ▼
SSE events  → client appends streamed tokens + tool-activity chips
            → after a write turn, client re-fetches affected docs; existing diff view shows changes
```

The server is stateless: every turn it receives the full thread, rebuilds pi-ai
`Message[]`, and streams. No server-side session store.

## Components

### Server — `src/server/assistant/`

**`tools.ts`** — native pi-ai `Tool[]` definitions (TypeBox/`typebox` schemas, the same
dependency pi-ai uses) + a `ToolExecutor` mapping tool name → server-side handler.

Read tools (read-only, cheap):
- `list_docs()` → ADR paths+titles, role ids, template ids.
- `read_doc(path)` → the document body (bounded/clipped like v1's `clip`).
- `search(query)` → substring matches across databank + `.sloop` libraries (path + snippet).

Write tools (auto-apply, executed server-side):
- `edit_doc(path, content)` → overwrite an existing doc's body. Unknown path → `isError`
  tool result (model can recover/report).
- `create_adr(title, content, slug?)` → `databank/<slug>.md`.
- `create_role(content, slug?)` → `.sloop/roles/<slug>.md`.
- `create_template(content, slug?)` → `.sloop/templates/<slug>.md`.

Collision-safe slug logic is **ported server-side from `src/web/assistant/planWrite.ts`**
(`slugify`/`uniqueSlug` against live ids). Each write returns a tool result naming the
written path so the model and client both learn what changed.

**`agent.ts`** — `runAssistantAgent({ messages, modelAlias }, deps)` where `deps` injects
`{ files, env, stream, toolExecutor }`. Resolves the alias through the registry (reuse
`pickAssistantAlias` / `resolveModel` / `toPiModel` from v1), then loops:

1. `stream(model, { systemPrompt, messages, tools }, { apiKey, signal })`.
2. Forward `text_delta` events as normalized output events.
3. On `done` with `stopReason: "toolUse"`: execute each `ToolCall` via `toolExecutor`,
   append the assistant message + `toolResult` messages to the in-loop context, loop.
4. On `done` with `stopReason: "stop"` (or `"length"`): finish.
5. **Bounded** at a max iteration count (~12) to prevent runaway tool loops.
6. Honors an `AbortSignal` (client disconnect / Stop button).

Emits a normalized async event stream (decoupled from pi-ai internals) consumed by the
SSE endpoint.

**`prompt.ts`** — rewritten system prompt: describes the conversational agent and its
tools (no envelope contract). Keeps `pickAssistantAlias`. Context docs (the open doc) are
injected as before.

**Retired:** `envelope.ts`, `envelope.test.ts`, single-shot `assistantService` +
`assistant()` method + `POST /api/assistant`, and the `AssistantProposal`/`AssistantAction`
shared types once nothing references them.

### Endpoint — `src/server/buildServer.ts`

- **New:** `POST /api/assistant/stream` — body `{ messages: ChatMessage[], model?: string }`,
  response `Content-Type: text/event-stream`. Pipes normalized agent events as SSE
  `data:` lines; flushes per event; ties an `AbortController` to client disconnect.
- **Kept:** `GET /api/models`.
- **Removed:** `POST /api/assistant`.

### Wire contract — `src/shared/`

Minimal, serializable, decoupled from pi-ai:

- `ChatMessage` — `{ role: 'user' | 'assistant'; text: string; tools?: ToolActivity[] }`
  where `ToolActivity = { tool: string; path?: string; ok: boolean }`. This is what the
  client stores and replays each turn; the server maps it to/from pi-ai `Message[]`.
  **Cross-turn fidelity:** prior turns collapse to plain `user`/`assistant` text messages
  (tool activity is informational, for the UI chips) — raw `ToolCall`/`ToolResult` message
  detail is reconstructed and passed to the model only *within* the current turn's loop,
  not replayed from history. This keeps the wire format small and avoids round-tripping
  provider-specific tool-call payloads.
- SSE event union (server → client): `text_delta` (`{ delta }`), `tool_start`
  (`{ tool, path? }`), `tool_result` (`{ tool, path?, ok }`), `done`, `error`
  (`{ message }`).

### Client — `src/web/assistant/` + `src/web/shell/AssistantRail.tsx`

**`useAssistantChat.ts`** (new hook) — holds `messages: ChatMessage[]`, `streaming`,
`error`. `send(text)` appends the user message, POSTs the full history to
`/api/assistant/stream`, reads the SSE body via `fetch` + `ReadableStream`, appends
streamed tokens to the in-progress assistant message, records tool activity, and exposes
`stop()` (aborts the fetch). Errors surface as an error state / in-thread notice.

**`AssistantRail.tsx`** (rebuilt) — a chat thread:
- Scrollable message list: user/assistant bubbles, live-streamed assistant tokens,
  tool-activity chips ("✎ Edited `databank/auth.md`", "＋ Created `databank/x.md`").
- Model picker (kept from v1).
- Bottom composer: textarea + Send / Stop.
- Width ~380px.
- After a turn that wrote files, trigger a refresh (re-fetch ADRs / navigate) so the
  existing diff view reflects the changes; if the written/edited doc is the one open in
  the editor, refresh it via `AssistantContext`.

**`planWrite.ts`** — client write-planning **removed** (logic moves server-side). Its slug
tests port to the server tool tests. `AssistantContext` is kept for open-doc context +
post-edit editor refresh.

**`api-client`** — add a `streamAssistant` binding; remove `requestAssistant`.

### Mock backend — `src/server/api/mock.ts` (+ contract)

A canned `streamAssistant` that emits a short fake token stream and one fake tool call +
tool result, so the chat UI runs end-to-end without a real model or API key (mirrors how
v1's mock served `assistant`).

## Error handling

- Per-tool failure → `isError` tool result fed back to the model (recover or report).
- Stream/provider error → `error` SSE event → surfaced in the thread.
- Max-iteration cap on the agent loop.
- Abort on client disconnect / Stop.
- Empty model registry → clear error (reuse v1 behavior).

## Testing

- **`tools.test.ts`** — slug collision safety (ported from `planWrite.test.ts`),
  `edit_doc` unknown-path → error result, `read_doc`/`search`/`list_docs` shape.
- **`agent.test.ts`** — fake `stream` emitting `toolUse` → executor runs → loop → `done`;
  multi-tool turn; max-iteration cap; abort mid-loop.
- **SSE serialization** — agent events → SSE lines round-trip.
- **`prompt.test.ts`** — updated for the new system prompt + alias selection (no envelope).
- **Client** — `useAssistantChat` SSE parsing/append (where feasible in jsdom).
- Mock-backed UI path exercised so the rail works offline.

## Out of scope (this iteration)

- Conversation persistence across reloads.
- Thinking-token display.
- In-app revert UI.
- Image input.

## Process / safety

- Built in the isolated worktree `/Users/typically/Workspace/sloop-assistant-chatbot`
  (branch `assistant-chatbot`, off `c344169`) — the shared main checkout churns and flips
  branches mid-session. Re-check `git branch --show-current` before every commit; commit
  via the worktree path.
