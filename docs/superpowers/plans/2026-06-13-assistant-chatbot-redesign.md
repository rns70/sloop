# Assistant Chatbot Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-shot, confirm-first global assistant with a streaming, multi-turn, auto-applying agentic chatbot built on pi-ai native tool-calling.

**Architecture:** A stateless SSE endpoint (`POST /api/assistant/stream`) drives a server-side agent loop (`runAssistantAgent`) that calls pi-ai's `stream()`, forwards text deltas, and on `toolUse` executes read/write tools (auto-apply to the working tree) and loops until the model stops. The client (`AssistantRail` rebuilt as a chat thread) holds the full conversation and replays it each turn; the existing diff view + git are the safety net.

**Tech Stack:** TypeScript, Node `http`/Express, `@earendil-works/pi-ai` (`stream`, `Tool`, `ToolCall`, `ToolResultMessage`), `typebox`, React, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-13-assistant-chatbot-redesign-design.md`

**Worktree:** `/Users/typically/Workspace/sloop-assistant-chatbot` (branch `assistant-chatbot`). Re-check `git branch --show-current` is `assistant-chatbot` before every commit (shared checkout churns).

**Test commands:** single file `npx vitest run <path>`; full suite `npm test`; types `npm run typecheck`.

---

## File Structure

**Create:**
- `src/server/assistant/tools.ts` — tool definitions + `ToolExecutor` + `AssistantWorkspace` interface.
- `src/server/assistant/tools.test.ts`
- `src/server/assistant/agent.ts` — `runAssistantAgent` streaming loop.
- `src/server/assistant/agent.test.ts`
- `src/server/assistant/piModel.ts` — `toPiModel` provider boundary (moved out of `assistantService.ts`).
- `src/web/assistant/useAssistantChat.ts` — client chat hook (SSE consumer).
- `src/web/assistant/useAssistantChat.test.ts`

**Modify:**
- `src/shared/types.ts` — add chat/stream wire types; remove `AssistantProposal`/`AssistantAction`/`AssistantRequest`.
- `src/server/assistant/prompt.ts` — rewrite system prompt; keep `pickAssistantAlias`.
- `src/server/assistant/prompt.test.ts` — update.
- `src/server/assistant/index.ts` — re-export new surface; drop envelope/service exports.
- `src/server/api/contract.ts` — add `assistantStream`; remove `assistant`.
- `src/server/api/real.ts` — implement `assistantStream`; build `AssistantWorkspace`; drop single-shot.
- `src/server/api/mock.ts` — canned `assistantStream`; drop single-shot.
- `src/server/buildServer.ts` — mount SSE route; remove `POST /api/assistant`.
- `src/web/api-client/index.ts` — add `streamAssistant`; remove `requestAssistant`.
- `src/web/shell/AssistantRail.tsx` — rebuild as chat thread.

**Delete:**
- `src/server/assistant/envelope.ts`, `src/server/assistant/envelope.test.ts`
- `src/server/assistant/assistantService.ts`, `src/server/assistant/assistantService.test.ts`
- `src/web/assistant/planWrite.ts`, `src/web/assistant/planWrite.test.ts`

---

## Task 1: Shared wire types

**Files:**
- Modify: `src/shared/types.ts` (assistant region, ~line 106-120)

- [ ] **Step 1: Replace the v1 assistant types with chat/stream wire types**

In `src/shared/types.ts`, delete `AssistantAction`, `AssistantRequest`, and `AssistantProposal` (keep `ModelOption`), and add:

```typescript
// ---- Global assistant (streaming, multi-turn, agentic) ----

/** One write the assistant performed in a turn — informational, drives UI chips. */
export interface ToolActivity {
  tool: string;          // e.g. 'edit_doc', 'create_adr'
  path?: string;         // workspace-relative path written, when applicable
  ok: boolean;
}

/** A message in the client-held conversation thread. Sent back in full each turn. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  tools?: ToolActivity[]; // assistant turns only; informational
}

/** POST /api/assistant/stream request body. */
export interface AssistantChatRequest {
  messages: ChatMessage[]; // full thread, oldest first; last entry is the new user turn
  model?: string;          // registry alias from the picker
}

/** Server → client SSE events (one JSON object per `data:` line). */
export type AssistantStreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_start'; tool: string; path?: string }
  | { type: 'tool_result'; tool: string; path?: string; ok: boolean }
  | { type: 'done' }
  | { type: 'error'; message: string };
```

- [ ] **Step 2: Verify shared barrel re-exports types**

Run: `grep -n "export \*\|export type \*\|from './types'" src/shared/index.ts`
Expected: `src/shared/index.ts` re-exports from `./types` (so the new types are exported). If it lists types explicitly, add `ChatMessage`, `ToolActivity`, `AssistantChatRequest`, `AssistantStreamEvent` and remove the deleted ones.

- [ ] **Step 3: Run typecheck to see the blast radius**

Run: `npm run typecheck`
Expected: FAILS — references to `AssistantRequest`/`AssistantProposal`/`AssistantAction` in `contract.ts`, `real.ts`, `mock.ts`, `assistantService.ts`, `envelope.ts`, `api-client`, `AssistantRail.tsx`, `planWrite.ts`. These are fixed/deleted in later tasks. This confirms the surface to migrate.

- [ ] **Step 4: Commit**

```bash
cd /Users/typically/Workspace/sloop-assistant-chatbot && [ "$(git branch --show-current)" = assistant-chatbot ] || { echo WRONG BRANCH; exit 1; }
git add src/shared/types.ts src/shared/index.ts
git commit -m "feat(types): chat/stream wire types for the assistant chatbot"
```

---

## Task 2: Server tools — definitions, workspace interface, executor

**Files:**
- Create: `src/server/assistant/tools.ts`
- Test: `src/server/assistant/tools.test.ts`

The tools are native pi-ai `Tool[]` (TypeBox schemas). The `ToolExecutor` runs a `ToolCall` against an injected `AssistantWorkspace` and returns a normalized result. Collision-safe slugs are ported from `src/web/shell/createItem.ts` (`slugify`/`uniqueSlug`) — re-implemented locally to avoid a web→server import.

- [ ] **Step 1: Write the failing test**

Create `src/server/assistant/tools.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { AdrDoc, RoleDef, TemplateDef, ModelRegistry } from '../../shared/index';
import { ASSISTANT_TOOLS, createToolExecutor, type AssistantWorkspace } from './tools';

function fakeWorkspace(over: Partial<AssistantWorkspace> = {}): { ws: AssistantWorkspace; writes: Array<{ path: string; body: string }> } {
  const writes: Array<{ path: string; body: string }> = [];
  const adrs: AdrDoc[] = [{ id: 'auth', relPath: 'databank/auth.md', title: 'Auth', body: 'Auth rules', acceptanceCriteria: [] }];
  const roles: RoleDef[] = [{ id: 'architect', name: 'Architect', defaultModel: 'opus', brief: '' }];
  const templates: TemplateDef[] = [];
  const ws: AssistantWorkspace = {
    listAdrs: async () => adrs,
    readAdr: async (p) => { const a = adrs.find((x) => x.relPath === p); if (!a) throw new Error('not found'); return a; },
    writeAdr: async (d) => { writes.push({ path: d.relPath, body: d.body }); },
    listRoles: async () => roles,
    listTemplates: async () => templates,
    writeRaw: async (p, c) => { writes.push({ path: p, body: c }); },
    readModelRegistry: async () => ({ models: {} } as ModelRegistry),
    ...over,
  };
  return { ws, writes };
}

describe('ASSISTANT_TOOLS', () => {
  it('exposes the read and write tools by name', () => {
    const names = ASSISTANT_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(['create_adr', 'create_role', 'create_template', 'edit_doc', 'list_docs', 'read_doc', 'search'].sort());
  });
});

describe('createToolExecutor', () => {
  it('create_adr uniquifies the slug against existing ADRs', async () => {
    const { ws, writes } = fakeWorkspace();
    const exec = createToolExecutor(ws);
    const r = await exec.run({ type: 'toolCall', id: '1', name: 'create_adr', arguments: { title: 'Auth', content: 'New body' } });
    expect(r.ok).toBe(true);
    expect(r.path).toBe('databank/auth-2.md'); // 'auth' taken
    expect(writes).toContainEqual({ path: 'databank/auth-2.md', body: 'New body' });
  });

  it('edit_doc on an ADR replaces the body', async () => {
    const { ws, writes } = fakeWorkspace();
    const exec = createToolExecutor(ws);
    const r = await exec.run({ type: 'toolCall', id: '2', name: 'edit_doc', arguments: { path: 'databank/auth.md', content: 'Rewritten' } });
    expect(r.ok).toBe(true);
    expect(writes).toContainEqual({ path: 'databank/auth.md', body: 'Rewritten' });
  });

  it('edit_doc on an unknown path returns an error result (never throws)', async () => {
    const { ws } = fakeWorkspace();
    const exec = createToolExecutor(ws);
    const r = await exec.run({ type: 'toolCall', id: '3', name: 'edit_doc', arguments: { path: 'databank/nope.md', content: 'x' } });
    expect(r.ok).toBe(false);
    expect(r.text.toLowerCase()).toContain('not found');
  });

  it('create_role writes the full file verbatim to .sloop/roles', async () => {
    const { ws, writes } = fakeWorkspace();
    const exec = createToolExecutor(ws);
    const full = '---\nid: sec\nname: Sec\ndefaultModel: opus\n---\n\nbrief';
    const r = await exec.run({ type: 'toolCall', id: '4', name: 'create_role', arguments: { content: full, slug: 'sec' } });
    expect(r.path).toBe('.sloop/roles/sec.md');
    expect(writes).toContainEqual({ path: '.sloop/roles/sec.md', body: full });
  });

  it('search returns matching ADR paths', async () => {
    const { ws } = fakeWorkspace();
    const exec = createToolExecutor(ws);
    const r = await exec.run({ type: 'toolCall', id: '5', name: 'search', arguments: { query: 'rules' } });
    expect(r.ok).toBe(true);
    expect(r.text).toContain('databank/auth.md');
  });

  it('unknown tool returns an error result', async () => {
    const { ws } = fakeWorkspace();
    const exec = createToolExecutor(ws);
    const r = await exec.run({ type: 'toolCall', id: '6', name: 'frobnicate', arguments: {} });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/assistant/tools.test.ts`
Expected: FAIL — `Cannot find module './tools'`.

- [ ] **Step 3: Write the implementation**

Create `src/server/assistant/tools.ts`:

```typescript
import { Type } from 'typebox';
import type { Tool, ToolCall } from '@earendil-works/pi-ai';
import type { AdrDoc, ModelRegistry, RoleDef, TemplateDef } from '../../shared/index';

/**
 * The agent's view of the workspace: read/list/search plus the two write primitives
 * (structured ADR write, raw file write). Implemented by the real backend over the
 * FilesService + fs, and by the mock in memory. Tools never reach the filesystem directly.
 */
export interface AssistantWorkspace {
  listAdrs(): Promise<AdrDoc[]>;
  readAdr(relPath: string): Promise<AdrDoc>;
  writeAdr(doc: AdrDoc): Promise<void>;
  listRoles(): Promise<RoleDef[]>;
  listTemplates(): Promise<TemplateDef[]>;
  /** Write a full file verbatim under the workspace (used for roles/templates). */
  writeRaw(relPath: string, content: string): Promise<void>;
  readModelRegistry(): Promise<ModelRegistry>;
}

/** Normalized executor result: `ok` drives the UI chip, `text` is fed back to the model. */
export interface ToolRunResult { ok: boolean; text: string; path?: string }

/** kebab-case a string into a filename-safe id; never empty. (Mirrors web `slugify`.) */
function slugify(name: string): string {
  const s = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'untitled';
}
/** First of `base`, `base-2`, … not already in `taken`. (Mirrors web `uniqueSlug`.) */
function uniqueSlug(base: string, taken: Set<string>): string {
  const b = slugify(base);
  if (!taken.has(b)) return b;
  for (let i = 2; ; i += 1) { const c = `${b}-${i}`; if (!taken.has(c)) return c; }
}
/** basename without extension: 'databank/x/auth.md' -> 'auth'. */
function baseId(path: string | undefined): string {
  if (!path) return '';
  return (path.split('/').pop() ?? '').replace(/\.md$/, '');
}

export const ASSISTANT_TOOLS: Tool[] = [
  { name: 'list_docs', description: 'List all databank ADRs (path + title), role ids, and template ids.',
    parameters: Type.Object({}) },
  { name: 'read_doc', description: 'Read the full markdown body of one document by its workspace-relative path.',
    parameters: Type.Object({ path: Type.String({ description: 'e.g. databank/auth.md' }) }) },
  { name: 'search', description: 'Find documents whose body or path contains the query (case-insensitive substring).',
    parameters: Type.Object({ query: Type.String() }) },
  { name: 'edit_doc', description: 'Overwrite an existing document. For a databank ADR, content is the new markdown body. For a role/template file, content is the full file.',
    parameters: Type.Object({ path: Type.String(), content: Type.String() }) },
  { name: 'create_adr', description: 'Create a new databank ADR. content is the markdown body only.',
    parameters: Type.Object({ title: Type.String(), content: Type.String(), slug: Type.Optional(Type.String()) }) },
  { name: 'create_role', description: 'Create a new role file. content is the FULL file: YAML frontmatter (id, name, defaultModel, optional color), a blank line, then the brief.',
    parameters: Type.Object({ content: Type.String(), slug: Type.Optional(Type.String()) }) },
  { name: 'create_template', description: 'Create a new template file. content is the FULL file: YAML frontmatter (id, name, stages: name/role/model), a blank line, then guidance.',
    parameters: Type.Object({ content: Type.String(), slug: Type.Optional(Type.String()) }) },
];

const CLIP = 6000;
const clip = (t: string): string => (t.length <= CLIP ? t : `${t.slice(0, CLIP)}\n…[truncated]`);

export interface ToolExecutor { run(call: ToolCall): Promise<ToolRunResult> }

export function createToolExecutor(ws: AssistantWorkspace): ToolExecutor {
  return {
    async run(call: ToolCall): Promise<ToolRunResult> {
      try {
        const a = call.arguments ?? {};
        switch (call.name) {
          case 'list_docs': {
            const [adrs, roles, templates] = await Promise.all([ws.listAdrs(), ws.listRoles(), ws.listTemplates()]);
            const lines = [
              ...adrs.map((d) => `ADR  ${d.relPath} — ${d.title}`),
              ...roles.map((r) => `role  ${r.id}`),
              ...templates.map((t) => `template  ${t.id}`),
            ];
            return { ok: true, text: lines.join('\n') || '(empty workspace)' };
          }
          case 'read_doc': {
            const doc = await ws.readAdr(String(a.path));
            return { ok: true, text: clip(doc.body), path: doc.relPath };
          }
          case 'search': {
            const q = String(a.query ?? '').toLowerCase();
            const adrs = await ws.listAdrs();
            const hits = adrs.filter((d) => d.relPath.toLowerCase().includes(q) || d.body.toLowerCase().includes(q));
            return { ok: true, text: hits.length ? hits.map((d) => `${d.relPath} — ${d.title}`).join('\n') : 'No matches.' };
          }
          case 'edit_doc': {
            const path = String(a.path);
            const content = String(a.content ?? '');
            if (path.startsWith('databank/')) {
              const adr = await ws.readAdr(path); // throws if unknown
              await ws.writeAdr({ ...adr, body: content });
            } else {
              await ws.writeRaw(path, content);
            }
            return { ok: true, text: `Edited ${path}.`, path };
          }
          case 'create_adr': {
            const taken = new Set((await ws.listAdrs()).map((d) => baseId(d.relPath)));
            const id = uniqueSlug(baseId(String(a.slug ?? '')) || slugify(String(a.title ?? 'untitled')), taken);
            const relPath = `databank/${id}.md`;
            await ws.writeAdr({ id, relPath, title: String(a.title ?? 'Untitled'), body: String(a.content ?? ''), acceptanceCriteria: [] });
            return { ok: true, text: `Created ${relPath}.`, path: relPath };
          }
          case 'create_role':
          case 'create_template': {
            const kind = call.name === 'create_role' ? 'roles' : 'templates';
            const taken = new Set((kind === 'roles' ? await ws.listRoles() : await ws.listTemplates()).map((x) => x.id));
            const id = uniqueSlug(baseId(String(a.slug ?? '')) || slugify(String(a.slug ?? kind)), taken);
            const relPath = `.sloop/${kind}/${id}.md`;
            await ws.writeRaw(relPath, String(a.content ?? ''));
            return { ok: true, text: `Created ${relPath}.`, path: relPath };
          }
          default:
            return { ok: false, text: `Unknown tool: ${call.name}` };
        }
      } catch (e: unknown) {
        return { ok: false, text: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/assistant/tools.test.ts`
Expected: PASS (6 tests). If the `typebox` import path errors, run `grep -rn "typebox\|@sinclair/typebox" node_modules/@earendil-works/pi-ai/dist/types.d.ts package.json` and match pi-ai's import specifier exactly (it may be `@sinclair/typebox`).

- [ ] **Step 5: Commit**

```bash
cd /Users/typically/Workspace/sloop-assistant-chatbot && [ "$(git branch --show-current)" = assistant-chatbot ] || { echo WRONG BRANCH; exit 1; }
git add src/server/assistant/tools.ts src/server/assistant/tools.test.ts
git commit -m "feat(assistant): native tool definitions + collision-safe executor"
```

---

## Task 3: Prompt rewrite + extract toPiModel

(Do this BEFORE Task 4 — the agent imports `buildAssistantSystemPrompt`, `pickAssistantAlias`, and `toPiModel`.)

**Files:**
- Create: `src/server/assistant/piModel.ts`
- Modify: `src/server/assistant/prompt.ts`, `src/server/assistant/prompt.test.ts`

- [ ] **Step 1: Create `piModel.ts` (move `toPiModel` out of the doomed `assistantService.ts`)**

Create `src/server/assistant/piModel.ts`:

```typescript
import type { Api, Model } from '@earendil-works/pi-ai';
import type { ResolvedModel } from '../../shared/index';

const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com';

/** Build a pi `Model` from a resolved registry entry — the one provider boundary. */
export function toPiModel(resolved: ResolvedModel): Model<Api> {
  const base = { id: resolved.id, name: resolved.id, input: ['text'] as ('text' | 'image')[],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  if (resolved.provider === 'anthropic') {
    return { ...base, api: 'anthropic-messages', provider: 'anthropic',
      baseUrl: resolved.baseUrl ?? ANTHROPIC_DEFAULT_BASE_URL, reasoning: true,
      contextWindow: 200_000, maxTokens: 8_192 };
  }
  if (!resolved.baseUrl) {
    throw new Error(`Provider "${resolved.provider}" requires a baseUrl in the model registry (OpenAI-compatible endpoint).`);
  }
  return { ...base, api: 'openai-completions', provider: resolved.provider, baseUrl: resolved.baseUrl,
    reasoning: false, contextWindow: 128_000, maxTokens: 8_192 };
}
```

- [ ] **Step 2: Rewrite `prompt.ts`**

Replace the entire contents of `src/server/assistant/prompt.ts` with:

```typescript
/**
 * Prompt construction for the conversational assistant. The model drives a tool-using
 * agent loop (see agent.ts); no envelope contract. Pure — no I/O, no SDK.
 */

const SYSTEM = [
  "You are sloop's assistant, a conversational agent operating over the whole app.",
  'You can answer questions and directly edit or create databank ADRs, roles, and templates.',
  '',
  'You have tools. Use them to act:',
  '  list_docs / read_doc / search — explore the workspace before acting.',
  '  edit_doc        — overwrite an existing document (databank ADR body, or a full role/template file).',
  '  create_adr      — a new databank requirement (content is the markdown body).',
  '  create_role     — a new role file (content is the FULL file: frontmatter + brief).',
  '  create_template — a new template file (content is the FULL file: frontmatter + guidance).',
  '',
  'Writes apply immediately — there is no confirmation step. Prefer reading a document',
  'before editing it. Keep replies concise; describe what you changed. When the user just',
  'wants an answer, reply in plain markdown without calling a tool.',
].join('\n');

/** The system prompt for the assistant agent. */
export function buildAssistantSystemPrompt(): string { return SYSTEM; }

/**
 * Pick the registry alias to run on: explicit per-request model, then SLOOP_ASSISTANT_MODEL,
 * then 'sonnet' if present, then the first alias. Throws if the registry is empty.
 */
export function pickAssistantAlias(
  model: string | undefined, env: NodeJS.ProcessEnv,
  registry: { models: Record<string, unknown> }, fallback = 'sonnet',
): string {
  const explicit = model?.trim() || env.SLOOP_ASSISTANT_MODEL?.trim();
  if (explicit) return explicit;
  if (registry.models[fallback]) return fallback;
  const first = Object.keys(registry.models)[0];
  if (!first) throw new Error('assistant: model registry is empty; cannot resolve a default model.');
  return first;
}
```

- [ ] **Step 3: Rewrite `prompt.test.ts`**

Replace `src/server/assistant/prompt.test.ts` with:

```typescript
import { describe, it, expect } from 'vitest';
import { buildAssistantSystemPrompt, pickAssistantAlias } from './prompt';

describe('buildAssistantSystemPrompt', () => {
  it('describes the tools and the no-confirmation behavior', () => {
    const s = buildAssistantSystemPrompt();
    expect(s).toContain('create_adr');
    expect(s).toContain('apply immediately');
  });
});

describe('pickAssistantAlias', () => {
  const reg = { models: { sonnet: {}, opus: {} } };
  it('honors an explicit model', () => { expect(pickAssistantAlias('opus', {} as NodeJS.ProcessEnv, reg)).toBe('opus'); });
  it('falls back to SLOOP_ASSISTANT_MODEL', () => { expect(pickAssistantAlias(undefined, { SLOOP_ASSISTANT_MODEL: 'opus' } as NodeJS.ProcessEnv, reg)).toBe('opus'); });
  it('defaults to sonnet when present', () => { expect(pickAssistantAlias(undefined, {} as NodeJS.ProcessEnv, reg)).toBe('sonnet'); });
  it('uses the first alias when no sonnet', () => { expect(pickAssistantAlias(undefined, {} as NodeJS.ProcessEnv, { models: { foo: {} } })).toBe('foo'); });
  it('throws on an empty registry', () => { expect(() => pickAssistantAlias(undefined, {} as NodeJS.ProcessEnv, { models: {} })).toThrow(); });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/server/assistant/prompt.test.ts`
Expected: PASS (6 tests). (`piModel.ts` has no test of its own — it's exercised by `agent.test.ts` indirectly and was unchanged behavior moved from `assistantService.ts`.)

- [ ] **Step 5: Commit**

```bash
cd /Users/typically/Workspace/sloop-assistant-chatbot && [ "$(git branch --show-current)" = assistant-chatbot ] || { echo WRONG BRANCH; exit 1; }
git add src/server/assistant/piModel.ts src/server/assistant/prompt.ts src/server/assistant/prompt.test.ts
git commit -m "feat(assistant): conversational system prompt + extract toPiModel"
```

---

## Task 4: Server agent loop

**Files:**
- Create: `src/server/assistant/agent.ts`
- Test: `src/server/assistant/agent.test.ts`

`runAssistantAgent` streams from an injected `stream` fn (so tests use a fake), forwards text deltas as `AssistantStreamEvent`s, executes tool calls on `toolUse`, appends assistant + toolResult messages, and loops until `stop`/`length` or a max-iteration cap.

- [ ] **Step 1: Write the failing test**

Create `src/server/assistant/agent.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { AssistantMessage, AssistantMessageEvent, ToolCall } from '@earendil-works/pi-ai';
import type { AssistantStreamEvent } from '../../shared/index';
import { runAssistantAgent, type AgentDeps } from './agent';
import type { ToolExecutor } from './tools';

/** Build a fake AssistantMessageEventStream-like async iterable from scripted events. */
function fakeStream(events: AssistantMessageEvent[]) {
  return { async *[Symbol.asyncIterator]() { for (const e of events) yield e; } };
}
function asstMsg(content: AssistantMessage['content'], stopReason: AssistantMessage['stopReason']): AssistantMessage {
  return { role: 'assistant', content, api: 'anthropic-messages', provider: 'anthropic', model: 'm',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason, timestamp: 0 };
}

const registry = { models: { sonnet: { provider: 'anthropic', id: 'claude-x' } } } as any;
const baseDeps = (streamFn: AgentDeps['stream'], exec: ToolExecutor): AgentDeps => ({
  stream: streamFn, toolExecutor: exec,
  env: { ANTHROPIC_API_KEY: 'k' } as NodeJS.ProcessEnv,
  readModelRegistry: async () => registry,
});

describe('runAssistantAgent', () => {
  it('streams text deltas then completes on stop', async () => {
    const text = asstMsg([{ type: 'text', text: 'Hello' }], 'stop');
    const streamFn = vi.fn(() => fakeStream([
      { type: 'text_delta', contentIndex: 0, delta: 'Hel', partial: text },
      { type: 'text_delta', contentIndex: 0, delta: 'lo', partial: text },
      { type: 'done', reason: 'stop', message: text },
    ]) as any);
    const exec: ToolExecutor = { run: vi.fn() };
    const out: AssistantStreamEvent[] = [];
    await runAssistantAgent({ messages: [{ role: 'user', text: 'hi' }] }, baseDeps(streamFn, exec), (e) => out.push(e));
    expect(out).toContainEqual({ type: 'text_delta', delta: 'Hel' });
    expect(out.at(-1)).toEqual({ type: 'done' });
    expect(exec.run).not.toHaveBeenCalled();
    expect(streamFn).toHaveBeenCalledTimes(1);
  });

  it('executes a tool call then loops and finishes', async () => {
    const toolCall: ToolCall = { type: 'toolCall', id: 't1', name: 'edit_doc', arguments: { path: 'databank/auth.md', content: 'x' } };
    const turn1 = asstMsg([toolCall], 'toolUse');
    const turn2 = asstMsg([{ type: 'text', text: 'done' }], 'stop');
    const streamFn = vi.fn()
      .mockReturnValueOnce(fakeStream([{ type: 'toolcall_end', contentIndex: 0, toolCall, partial: turn1 }, { type: 'done', reason: 'toolUse', message: turn1 }]) as any)
      .mockReturnValueOnce(fakeStream([{ type: 'text_delta', contentIndex: 0, delta: 'done', partial: turn2 }, { type: 'done', reason: 'stop', message: turn2 }]) as any);
    const exec: ToolExecutor = { run: vi.fn(async () => ({ ok: true, text: 'Edited databank/auth.md.', path: 'databank/auth.md' })) };
    const out: AssistantStreamEvent[] = [];
    await runAssistantAgent({ messages: [{ role: 'user', text: 'edit it' }] }, baseDeps(streamFn, exec), (e) => out.push(e));
    expect(exec.run).toHaveBeenCalledTimes(1);
    expect(out).toContainEqual({ type: 'tool_start', tool: 'edit_doc', path: 'databank/auth.md' });
    expect(out).toContainEqual({ type: 'tool_result', tool: 'edit_doc', path: 'databank/auth.md', ok: true });
    expect(streamFn).toHaveBeenCalledTimes(2);
    expect(out.at(-1)).toEqual({ type: 'done' });
  });

  it('stops at the max-iteration cap and emits done', async () => {
    const toolCall: ToolCall = { type: 'toolCall', id: 't', name: 'list_docs', arguments: {} };
    const loopTurn = asstMsg([toolCall], 'toolUse');
    const streamFn = vi.fn(() => fakeStream([{ type: 'toolcall_end', contentIndex: 0, toolCall, partial: loopTurn }, { type: 'done', reason: 'toolUse', message: loopTurn }]) as any);
    const exec: ToolExecutor = { run: vi.fn(async () => ({ ok: true, text: 'ok' })) };
    const out: AssistantStreamEvent[] = [];
    await runAssistantAgent({ messages: [{ role: 'user', text: 'go' }] }, { ...baseDeps(streamFn, exec), maxIterations: 3 }, (e) => out.push(e));
    expect(streamFn).toHaveBeenCalledTimes(3);
    expect(out.at(-1)).toEqual({ type: 'done' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/assistant/agent.test.ts`
Expected: FAIL — `Cannot find module './agent'`.

- [ ] **Step 3: Write the implementation**

Create `src/server/assistant/agent.ts`:

```typescript
import type { Api, AssistantMessage, AssistantMessageEvent, Context, Message, Model, ToolCall } from '@earendil-works/pi-ai';
import type { AssistantChatRequest, AssistantStreamEvent, ChatMessage, ModelRegistry } from '../../shared/index';
import { resolveModel } from '../../shared/index';
import { ASSISTANT_TOOLS, type ToolExecutor } from './tools';
import { pickAssistantAlias, buildAssistantSystemPrompt } from './prompt';
import { toPiModel } from './piModel';

/** The streaming primitive, injectable for tests. Matches pi-ai's `stream` shape. */
export type StreamFn = (
  model: Model<Api>, context: Context,
  options?: { apiKey?: string; signal?: AbortSignal; maxTokens?: number },
) => AsyncIterable<AssistantMessageEvent>;

export interface AgentDeps {
  stream: StreamFn;
  toolExecutor: ToolExecutor;
  env: NodeJS.ProcessEnv;
  readModelRegistry: () => Promise<ModelRegistry>;
  maxIterations?: number;
}

const DEFAULT_MAX_ITERATIONS = 12;

/** Map the client thread to pi-ai messages (prior turns collapse to plain text). */
function toPiMessages(messages: ChatMessage[]): Message[] {
  return messages.map((m) => ({ role: m.role, content: m.text, timestamp: 0 } as Message));
}

export async function runAssistantAgent(
  req: AssistantChatRequest,
  deps: AgentDeps,
  emit: (e: AssistantStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const registry = await deps.readModelRegistry();
  const alias = pickAssistantAlias(req.model, deps.env, registry);
  const resolved = resolveModel(alias, registry, deps.env);
  const model = toPiModel(resolved);
  const system = buildAssistantSystemPrompt();
  const messages = toPiMessages(req.messages);
  const max = deps.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  for (let i = 0; i < max; i += 1) {
    if (signal?.aborted) { emit({ type: 'done' }); return; }
    const context: Context = { systemPrompt: system, messages, tools: ASSISTANT_TOOLS };
    const stream = deps.stream(model, context, { apiKey: resolved.apiKey, signal, maxTokens: 4096 });

    let final: AssistantMessage | undefined;
    const calls: ToolCall[] = [];
    for await (const ev of stream) {
      if (ev.type === 'text_delta') emit({ type: 'text_delta', delta: ev.delta });
      else if (ev.type === 'toolcall_end') calls.push(ev.toolCall);
      else if (ev.type === 'done') final = ev.message;
      else if (ev.type === 'error') { emit({ type: 'error', message: ev.error.errorMessage ?? 'stream error' }); return; }
    }

    if (!final) { emit({ type: 'error', message: 'stream ended without a final message' }); return; }
    if (final.stopReason !== 'toolUse' || calls.length === 0) { emit({ type: 'done' }); return; }

    // Append the assistant turn (with its tool calls), then run each tool and append results.
    messages.push(final);
    for (const call of calls) {
      const path = typeof call.arguments?.path === 'string' ? call.arguments.path
        : typeof call.arguments?.slug === 'string' ? call.arguments.slug : undefined;
      emit({ type: 'tool_start', tool: call.name, path });
      const result = await deps.toolExecutor.run(call);
      emit({ type: 'tool_result', tool: call.name, path: result.path ?? path, ok: result.ok });
      messages.push({ role: 'toolResult', toolCallId: call.id, toolName: call.name,
        content: [{ type: 'text', text: result.text }], isError: !result.ok, timestamp: 0 });
    }
  }
  emit({ type: 'done' }); // max-iteration cap reached
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/server/assistant/agent.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/typically/Workspace/sloop-assistant-chatbot && [ "$(git branch --show-current)" = assistant-chatbot ] || { echo WRONG BRANCH; exit 1; }
git add src/server/assistant/agent.ts src/server/assistant/agent.test.ts
git commit -m "feat(assistant): streaming agent loop with bounded tool iterations"
```

---

## Task 5: Contract — add streaming method, drop single-shot

**Files:**
- Modify: `src/server/api/contract.ts`

- [ ] **Step 1: Update the contract**

In `src/server/api/contract.ts`:
- In the type re-export (line ~27), replace `AssistantRequest, AssistantProposal` with `AssistantChatRequest, AssistantStreamEvent` (keep `ModelOption`).
- Replace the `AssistantRequestBody`/`AssistantResponse` aliases (lines ~64-67) with:

```typescript
/** POST /api/assistant/stream — streaming, multi-turn, agentic assistant. */
export type AssistantStreamRequestBody = AssistantChatRequest;
```

- In `interface SloopApi`, replace the `assistant(req)` method (lines ~86-87) with:

```typescript
  /** Streaming agentic assistant: emits events as it thinks/acts; auto-applies writes. */
  assistantStream(req: AssistantChatRequest, onEvent: (e: AssistantStreamEvent) => void, signal?: AbortSignal): Promise<void>;
```

- Update the route comment block (lines ~15-16): replace the `POST /api/assistant` line with `POST /api/assistant/stream  -> SSE AssistantStreamEvent   body: AssistantStreamRequestBody`.

- [ ] **Step 2: Run typecheck (expect mock/real errors)**

Run: `npm run typecheck`
Expected: FAIL — `mock.ts` and `real.ts` no longer satisfy `SloopApi` (missing `assistantStream`, stale `assistant`). Fixed in Tasks 6-7.

- [ ] **Step 3: Commit**

```bash
cd /Users/typically/Workspace/sloop-assistant-chatbot && [ "$(git branch --show-current)" = assistant-chatbot ] || { echo WRONG BRANCH; exit 1; }
git add src/server/api/contract.ts
git commit -m "feat(api): streaming assistant contract method"
```

---

## Task 6: Real backend — implement assistantStream

**Files:**
- Modify: `src/server/api/real.ts`

Wire the agent to pi-ai's real `stream` and build the `AssistantWorkspace` over the `FilesService` + an fs-based `writeRaw`. Drop the single-shot `assistant`/`assistantService`.

- [ ] **Step 1: Update imports and constructor**

In `src/server/api/real.ts`:
- Change the pi-ai import (line ~20) to include `stream`: e.g. `import { stream } from '@earendil-works/pi-ai';` — first check what's currently imported with `grep -n "@earendil-works/pi-ai" src/server/api/real.ts` and add `stream` to that import (keep `complete` only if still used; verify with `grep -n "complete(" src/server/api/real.ts`).
- Replace the assistant import (line 37) with:
  `import { runAssistantAgent } from '../assistant/agent';`
  `import { createToolExecutor, type AssistantWorkspace } from '../assistant/tools';`
  `import { toModelOptions } from '../assistant/index';`
- Remove `createAssistantService` / `type AssistantService`. Remove the `assistantService` constructor param (line ~205), the `createAssistantService({ files, env })` line (line ~215), and that arg in `new RealApi(...)` (line ~234).
- In the type imports (lines ~41, ~50), replace `AssistantResponse` / `AssistantRequest` with `AssistantChatRequest, AssistantStreamEvent`.
- `RealApi` needs `env` and the workspace `root`. Check what it stores: `grep -n "private readonly\|this\.env\|this\.root\|static async create" src/server/api/real.ts`. If `env`/`root` are not already fields, add them as constructor params and pass them from `create(root, env)` (where both are in scope).

- [ ] **Step 2: Build the workspace adapter + replace the assistant method**

Replace the `assistant(req)` method (lines ~281-283) with `assistantStream` plus a private workspace builder. Add node imports if absent (`grep -n "node:fs\|node:path" src/server/api/real.ts`): `import { promises as fs } from 'node:fs';` and `import { join, normalize, dirname, sep } from 'node:path';`.

```typescript
  private assistantWorkspace(): AssistantWorkspace {
    const files = this.files;
    const root = this.root; // absolute workspace root
    return {
      listAdrs: () => files.listAdrs(),
      readAdr: (p) => files.readAdr(p),
      writeAdr: (d) => files.writeAdr(d),
      listRoles: () => files.listRoles(),
      listTemplates: () => files.listTemplates(),
      readModelRegistry: () => files.readModelRegistry(),
      writeRaw: async (relPath, content) => {
        const abs = normalize(join(root, relPath));
        if (abs !== root && !abs.startsWith(root + sep)) throw new Error(`Path escapes the workspace: ${relPath}`);
        await fs.mkdir(dirname(abs), { recursive: true });
        await fs.writeFile(abs, content, 'utf8');
      },
    };
  }

  async assistantStream(req: AssistantChatRequest, onEvent: (e: AssistantStreamEvent) => void, signal?: AbortSignal): Promise<void> {
    await runAssistantAgent(req, {
      stream,
      toolExecutor: createToolExecutor(this.assistantWorkspace()),
      env: this.env,
      readModelRegistry: () => this.files.readModelRegistry(),
    }, onEvent, signal);
  }
```

- [ ] **Step 3: Run typecheck (real.ts should be clean; mock still errors)**

Run: `npm run typecheck 2>&1 | grep "real.ts" || echo "real.ts clean"`
Expected: `real.ts clean` (mock.ts still errors — Task 7).

- [ ] **Step 4: Run the existing real backend test**

Run: `npx vitest run src/server/api/real.test.ts`
Expected: PASS. If a test referenced the old `assistant` method, update it to call `assistantStream` collecting events into an array and assert the last event is `{ type: 'done' }`.

- [ ] **Step 5: Commit**

```bash
cd /Users/typically/Workspace/sloop-assistant-chatbot && [ "$(git branch --show-current)" = assistant-chatbot ] || { echo WRONG BRANCH; exit 1; }
git add src/server/api/real.ts
git commit -m "feat(api): real backend streams the agentic assistant"
```

---

## Task 7: Mock backend — canned assistantStream

**Files:**
- Modify: `src/server/api/mock.ts`

- [ ] **Step 1: Replace the mock `assistant` method**

In `src/server/api/mock.ts`, update the import (line ~16: `AssistantRequest, AssistantResponse` → `AssistantChatRequest, AssistantStreamEvent`) and replace the `assistant(req)` method (lines ~197-225) with a canned stream:

```typescript
  async assistantStream(req: AssistantChatRequest, onEvent: (e: AssistantStreamEvent) => void): Promise<void> {
    const last = [...req.messages].reverse().find((m) => m.role === 'user');
    const text = (last?.text ?? '').trim();
    for (const tok of `You said: ${text}`.match(/\S+\s*/g) ?? []) onEvent({ type: 'text_delta', delta: tok });
    if (/adr|requirement|document/i.test(text)) {
      const relPath = 'databank/mock-note.md';
      onEvent({ type: 'tool_start', tool: 'create_adr', path: relPath });
      this.adrs.push({ id: 'mock-note', relPath, title: 'Mock note', body: text, acceptanceCriteria: [] });
      onEvent({ type: 'tool_result', tool: 'create_adr', path: relPath, ok: true });
    }
    onEvent({ type: 'done' });
  }
```

(Confirm the mock stores ADRs as `this.adrs` and the `AdrDoc` shape — `grep -n "this.adrs\|adrs:" src/server/api/mock.ts`. Adjust the push to match the field names.)

- [ ] **Step 2: Run typecheck (backends should be clean now)**

Run: `npm run typecheck 2>&1 | grep -E "mock.ts|real.ts|contract" || echo "backends clean"`
Expected: `backends clean`.

- [ ] **Step 3: Run mock tests**

Run: `npx vitest run src/server/api 2>&1 | tail -5`
Expected: PASS. If a mock test asserted the old proposal shape, replace it: collect events from `assistantStream`, assert it ends with `{ type: 'done' }` and (for an "adr" prompt) contains a `tool_result` with `ok: true`.

- [ ] **Step 4: Commit**

```bash
cd /Users/typically/Workspace/sloop-assistant-chatbot && [ "$(git branch --show-current)" = assistant-chatbot ] || { echo WRONG BRANCH; exit 1; }
git add src/server/api/mock.ts
git commit -m "feat(api): mock backend streams a canned assistant turn"
```

---

## Task 8: SSE endpoint in buildServer

**Files:**
- Modify: `src/server/buildServer.ts`

- [ ] **Step 1: Replace the `POST /api/assistant` route with the SSE stream route**

In `src/server/buildServer.ts`, remove the line `app.post('/api/assistant', ...)` (line ~88) and add, right after the `GET /api/models` line:

```typescript
  app.post('/api/assistant/stream', (req: Request, res: Response) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    const controller = new AbortController();
    req.on('close', () => controller.abort());
    const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    api.assistantStream(req.body, send, controller.signal)
      .catch((err: unknown) => send({ type: 'error', message: err instanceof Error ? err.message : String(err) }))
      .finally(() => res.end());
  });
```

(No `h()` wrapper — SSE manages its own response lifecycle and never returns JSON.)

- [ ] **Step 2: Typecheck + full server tests**

Run: `npm run typecheck && npx vitest run src/server 2>&1 | tail -5`
Expected: typecheck clean; server tests PASS.

- [ ] **Step 3: Commit**

```bash
cd /Users/typically/Workspace/sloop-assistant-chatbot && [ "$(git branch --show-current)" = assistant-chatbot ] || { echo WRONG BRANCH; exit 1; }
git add src/server/buildServer.ts
git commit -m "feat(server): SSE endpoint for the streaming assistant"
```

---

## Task 9: Retire v1 server modules + fix barrel exports

**Files:**
- Delete: `src/server/assistant/envelope.ts`, `envelope.test.ts`, `assistantService.ts`, `assistantService.test.ts`
- Modify: `src/server/assistant/index.ts`

- [ ] **Step 1: Delete the dead modules**

```bash
cd /Users/typically/Workspace/sloop-assistant-chatbot
git rm src/server/assistant/envelope.ts src/server/assistant/envelope.test.ts src/server/assistant/assistantService.ts src/server/assistant/assistantService.test.ts
```

(Keep `models.ts`/`models.test.ts` — `toModelOptions` is still used. Verify: `grep -rn "toModelOptions" src/`.)

- [ ] **Step 2: Rewrite `src/server/assistant/index.ts`**

```typescript
// Global assistant — server side. A streaming, multi-turn agent loop over pi-ai native
// tools; auto-applies writes. Behind `POST /api/assistant/stream`.
export { runAssistantAgent, type AgentDeps, type StreamFn } from './agent';
export { ASSISTANT_TOOLS, createToolExecutor, type AssistantWorkspace, type ToolExecutor, type ToolRunResult } from './tools';
export { buildAssistantSystemPrompt, pickAssistantAlias } from './prompt';
export { toPiModel } from './piModel';
export { toModelOptions } from './models';
```

- [ ] **Step 3: Typecheck + full server/shared suite**

Run: `npm run typecheck 2>&1 | grep -vE "web/|AssistantRail|api-client|planWrite" | tail -10`
Expected: no server/shared errors remain (only web-side references to removed `requestAssistant`/`planWrite` may still error — resolved in Tasks 10-12).

- [ ] **Step 4: Commit**

```bash
cd /Users/typically/Workspace/sloop-assistant-chatbot && [ "$(git branch --show-current)" = assistant-chatbot ] || { echo WRONG BRANCH; exit 1; }
git add -A src/server/assistant/
git commit -m "refactor(assistant): retire single-shot envelope/service path"
```

---

## Task 10: api-client — streamAssistant binding

**Files:**
- Modify: `src/web/api-client/index.ts`

The browser consumes SSE via `fetch` + a `ReadableStream` reader (not `EventSource`, which is GET-only). `streamAssistant` POSTs the thread and invokes `onEvent` per parsed `data:` line.

- [ ] **Step 1: Replace the assistant binding**

In `src/web/api-client/index.ts`:
- Update the type import (line ~16): replace `AssistantRequest, AssistantProposal` with `AssistantChatRequest, AssistantStreamEvent` (keep `ModelOption`).
- Remove `requestAssistant` (line ~62) and any now-unused `AssistantRequestBody`/`AssistantResponse` import.
- First confirm the URL prefix the file uses: `grep -n "fetch(\|const http\|API_BASE\|'/api" src/web/api-client/index.ts`. Match the `fetch` URL below to that prefix (likely `/api/assistant/stream`).
- Add:

```typescript
/** POST the full thread and stream agent events. Returns the completion promise + an abort fn. */
export function streamAssistant(
  req: AssistantChatRequest,
  onEvent: (e: AssistantStreamEvent) => void,
): { done: Promise<void>; abort: () => void } {
  const controller = new AbortController();
  const done = (async () => {
    const res = await fetch('/api/assistant/stream', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req), signal: controller.signal,
    });
    if (!res.body) throw new Error('assistant: no response stream');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buf += decoder.decode(value, { stream: true });
      const frames = buf.split('\n\n');
      buf = frames.pop() ?? '';
      for (const frame of frames) {
        const line = frame.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        try { onEvent(JSON.parse(line.slice(5).trim()) as AssistantStreamEvent); } catch { /* ignore partial */ }
      }
    }
  })();
  return { done, abort: () => controller.abort() };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck 2>&1 | grep "api-client" || echo "api-client clean"`
Expected: `api-client clean`.

- [ ] **Step 3: Commit**

```bash
cd /Users/typically/Workspace/sloop-assistant-chatbot && [ "$(git branch --show-current)" = assistant-chatbot ] || { echo WRONG BRANCH; exit 1; }
git add src/web/api-client/index.ts
git commit -m "feat(web): streamAssistant SSE client binding"
```

---

## Task 11: useAssistantChat hook

**Files:**
- Create: `src/web/assistant/useAssistantChat.ts`
- Test: `src/web/assistant/useAssistantChat.test.ts`
- Delete: `src/web/assistant/planWrite.ts`, `src/web/assistant/planWrite.test.ts`

- [ ] **Step 1: Delete the obsolete client write planner**

```bash
cd /Users/typically/Workspace/sloop-assistant-chatbot
git rm src/web/assistant/planWrite.ts src/web/assistant/planWrite.test.ts
```

(Slug logic now lives server-side in `tools.ts`; its behavior is covered by `tools.test.ts`.)

- [ ] **Step 2: Write the failing test**

Create `src/web/assistant/useAssistantChat.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { AssistantStreamEvent } from '../../shared/index';
import * as api from '../api-client/index';
import { useAssistantChat } from './useAssistantChat';

describe('useAssistantChat', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('appends a user message and streams the assistant reply', async () => {
    const events: AssistantStreamEvent[] = [
      { type: 'text_delta', delta: 'Hi ' },
      { type: 'text_delta', delta: 'there' },
      { type: 'tool_result', tool: 'create_adr', path: 'databank/x.md', ok: true },
      { type: 'done' },
    ];
    vi.spyOn(api, 'streamAssistant').mockImplementation((_req, onEvent) => {
      for (const e of events) onEvent(e);
      return { done: Promise.resolve(), abort: () => {} };
    });
    const onWrote = vi.fn();
    const { result } = renderHook(() => useAssistantChat({ model: 'sonnet', onWrote }));
    await act(async () => { await result.current.send('hello'); });
    await waitFor(() => expect(result.current.streaming).toBe(false));
    const msgs = result.current.messages;
    expect(msgs[0]).toEqual({ role: 'user', text: 'hello' });
    expect(msgs[1].role).toBe('assistant');
    expect(msgs[1].text).toBe('Hi there');
    expect(msgs[1].tools).toContainEqual({ tool: 'create_adr', path: 'databank/x.md', ok: true });
    expect(onWrote).toHaveBeenCalledWith(['databank/x.md']);
  });

  it('surfaces an error event', async () => {
    vi.spyOn(api, 'streamAssistant').mockImplementation((_req, onEvent) => {
      onEvent({ type: 'error', message: 'boom' });
      return { done: Promise.resolve(), abort: () => {} };
    });
    const { result } = renderHook(() => useAssistantChat({ model: 'sonnet' }));
    await act(async () => { await result.current.send('x'); });
    await waitFor(() => expect(result.current.error).toBe('boom'));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/web/assistant/useAssistantChat.test.ts`
Expected: FAIL — `Cannot find module './useAssistantChat'`.

- [ ] **Step 4: Write the implementation**

Create `src/web/assistant/useAssistantChat.ts`:

```typescript
import { useCallback, useRef, useState } from 'react';
import { streamAssistant } from '../api-client/index';
import type { ChatMessage, ToolActivity } from '../../shared/index';

export interface UseAssistantChat {
  messages: ChatMessage[];
  streaming: boolean;
  error: string | null;
  send: (text: string) => Promise<void>;
  stop: () => void;
}

/** Holds the conversation thread, streams agent turns, and reports written paths. */
export function useAssistantChat(opts: { model?: string; onWrote?: (paths: string[]) => void }): UseAssistantChat {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<(() => void) | null>(null);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || streaming) return;
    setError(null);
    const history: ChatMessage[] = [...messages, { role: 'user', text: trimmed }];
    // Seed an empty assistant message we stream into.
    setMessages([...history, { role: 'assistant', text: '', tools: [] }]);
    setStreaming(true);
    const wrote: string[] = [];
    const patchAssistant = (fn: (m: ChatMessage) => ChatMessage) =>
      setMessages((cur) => cur.map((m, i) => (i === cur.length - 1 ? fn(m) : m)));

    const { done, abort } = streamAssistant({ messages: history, model: opts.model }, (e) => {
      if (e.type === 'text_delta') patchAssistant((m) => ({ ...m, text: m.text + e.delta }));
      else if (e.type === 'tool_result') {
        const activity: ToolActivity = { tool: e.tool, path: e.path, ok: e.ok };
        if (e.ok && e.path) wrote.push(e.path);
        patchAssistant((m) => ({ ...m, tools: [...(m.tools ?? []), activity] }));
      } else if (e.type === 'error') setError(e.message);
    });
    abortRef.current = abort;
    try { await done; } catch (err: unknown) { setError(err instanceof Error ? err.message : String(err)); }
    finally {
      setStreaming(false);
      abortRef.current = null;
      if (wrote.length) opts.onWrote?.(wrote);
    }
  }, [messages, streaming, opts]);

  const stop = useCallback(() => { abortRef.current?.(); setStreaming(false); }, []);

  return { messages, streaming, error, send, stop };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/web/assistant/useAssistantChat.test.ts`
Expected: PASS (2 tests). If `@testing-library/react`'s `renderHook` is unavailable (check: `grep -rn "renderHook\|@testing-library/react" src/web package.json`), extract the event-reducer into a pure `applyEvent(messages, e)` function in the hook file and unit-test that instead, keeping the hook a thin wrapper.

- [ ] **Step 6: Commit**

```bash
cd /Users/typically/Workspace/sloop-assistant-chatbot && [ "$(git branch --show-current)" = assistant-chatbot ] || { echo WRONG BRANCH; exit 1; }
git add -A src/web/assistant/
git commit -m "feat(web): useAssistantChat hook + drop client write planner"
```

---

## Task 12: Rebuild AssistantRail as a chat thread

**Files:**
- Modify: `src/web/shell/AssistantRail.tsx`, possibly `src/web/assistant/AssistantContext.tsx`

Reuse the model picker + `AssistantContext`. Replace the single instruction box + one-proposal panel with a scrolling message thread + bottom composer. After a turn writes files, navigate to the last written path so the existing diff view reflects it.

- [ ] **Step 1: Rewrite the component**

Replace the contents of `src/web/shell/AssistantRail.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getModels, type ModelOption } from '../api-client/index';
import { Button, Label, cx } from '../design/index';
import { useAssistant } from '../assistant/AssistantContext';
import { useAssistantChat } from '../assistant/useAssistantChat';

export function AssistantRail({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { openDoc } = useAssistant();
  const [models, setModels] = useState<ModelOption[]>([]);
  const [alias, setAlias] = useState('');
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getModels()
      .then((opts) => { setModels(opts); setAlias((a) => a || opts[0]?.alias || ''); })
      .catch((e: unknown) => setModelsError(e instanceof Error ? e.message : String(e)));
  }, []);

  const onWrote = (paths: string[]) => {
    const last = paths[paths.length - 1];
    if (last?.startsWith('databank/')) navigate(`/databank/${last.replace(/^databank\//, '')}`);
    else if (last) navigate('/libraries');
  };

  const { messages, streaming, error, send, stop } = useAssistantChat({ model: alias || undefined, onWrote });

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [messages]);

  const submit = () => { const t = draft.trim(); if (!t || streaming) return; setDraft(''); void send(t); };

  return (
    <aside className={cx('flex w-[380px] shrink-0 flex-col border-l border-line-hair bg-sidebar text-[13px]', className)}>
      <div className="border-b border-line-hair px-4 py-3">
        <Label>Assistant</Label>
        <select
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          disabled={models.length === 0}
          className="mt-2 w-full rounded border border-line-soft bg-paper px-2 py-1 text-[12px] text-ink-muted outline-none focus:border-accent disabled:opacity-60"
        >
          {models.length === 0
            ? <option value="">No models configured (.sloop/config.md)</option>
            : models.map((m) => <option key={m.alias} value={m.alias}>{m.alias} — {m.provider} / {m.id}</option>)}
        </select>
        <div className="mt-1 text-[11px] text-ink-faint">{openDoc ? `Context: ${openDoc.relPath}` : 'Context: whole app'}</div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 && <p className="text-[12px] text-ink-faint">Ask a question, or tell me to edit or create an ADR, role, or template. Changes apply directly.</p>}
        {messages.map((m, i) => (
          <div key={i} className={cx('rounded-md px-3 py-2', m.role === 'user' ? 'bg-line-soft' : 'border border-line-soft bg-paper')}>
            <div className="mb-1 text-[10px] uppercase tracking-[0.07em] text-ink-faint">{m.role}</div>
            <pre className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-ink">{m.text || (streaming && i === messages.length - 1 ? '…' : '')}</pre>
            {m.tools?.map((t, j) => (
              <div key={j} className="mt-1 font-mono text-[11px] text-ink-faint">{t.ok ? '✎' : '⚠'} {t.tool}{t.path ? ` ${t.path}` : ''}</div>
            ))}
          </div>
        ))}
        {(error || modelsError) && <p className="text-[12px] text-status-failed">{error ?? modelsError}</p>}
      </div>

      <div className="border-t border-line-hair px-4 py-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          rows={3}
          placeholder="Message the assistant…  (Enter to send, Shift+Enter for newline)"
          className="w-full resize-y rounded border border-line-soft bg-paper px-2 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
        />
        <div className="mt-2 flex gap-2">
          {streaming
            ? <Button variant="subtle" onClick={stop}>Stop</Button>
            : <Button variant="primary" disabled={!draft.trim()} onClick={submit}>Send</Button>}
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Confirm the `openDoc` shape still type-checks**

The rewrite only reads `openDoc.relPath`. Confirm that field exists: `grep -n "relPath\|interface\|type OpenDoc\|openDoc" src/web/assistant/AssistantContext.tsx`. The old `applyInline`/`getValue` usage is gone; if `AssistantContext`'s exported type required those as non-optional and nothing else sets them, leave the type as-is (we only consume `relPath`). No change needed unless typecheck complains.

- [ ] **Step 3: Typecheck + build the web bundle**

Run: `npm run typecheck && npm run build 2>&1 | tail -5`
Expected: typecheck clean; `vite build` succeeds.

- [ ] **Step 4: Commit**

```bash
cd /Users/typically/Workspace/sloop-assistant-chatbot && [ "$(git branch --show-current)" = assistant-chatbot ] || { echo WRONG BRANCH; exit 1; }
git add src/web/shell/AssistantRail.tsx src/web/assistant/AssistantContext.tsx
git commit -m "feat(web): rebuild AssistantRail as a streaming chat thread"
```

---

## Task 13: Full verification + manual smoke

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test 2>&1 | tail -8`
Expected: all tests PASS. (Baseline was 161; net change: removed envelope/assistantService/planWrite tests, added tools/agent/prompt/useAssistantChat tests.)

- [ ] **Step 2: Typecheck + production build**

Run: `npm run typecheck && npm run build 2>&1 | tail -3`
Expected: both clean.

- [ ] **Step 3: Manual smoke against the mock backend**

Run the dev server against the mock backend and exercise the rail in a browser (use the project's run skill / `npm run dev`). Send "hello" (expect streamed "You said: hello"), then "create an ADR about caching" (expect a `create_adr` chip + navigation to the new databank doc). Confirm: tokens stream incrementally, the Stop button appears mid-stream, tool chips render, and a written doc appears in the databank with the diff view available.

- [ ] **Step 4: Final commit (if any reconciliation changes)**

```bash
cd /Users/typically/Workspace/sloop-assistant-chatbot && [ "$(git branch --show-current)" = assistant-chatbot ] || { echo WRONG BRANCH; exit 1; }
git add -A && git commit -m "test: verify assistant chatbot end to end" || echo "nothing to commit"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** streaming (Tasks 4,8,10), multi-turn (Task 1 `messages`, Task 11 history replay), auto-apply (Task 2 write tools, Task 6 real writes), read/search reach (Task 2), native tools (Tasks 2,4), widened rail chat UI (Task 12), no-confirm/no-revert (no gate built; diff-view refresh via `onWrote` navigation), retired v1 (Tasks 5-9), mock path (Task 7), error handling (agent error event, SSE catch, hook error state, max-iter cap), cross-turn fidelity (Task 4 `toPiMessages`).
- **Type consistency:** `AssistantStreamEvent`/`ChatMessage`/`AssistantChatRequest`/`ToolActivity` defined in Task 1, used identically in agent, contract, real, mock, api-client, hook. Tool names (`edit_doc`, `create_adr`, `create_role`, `create_template`, `list_docs`, `read_doc`, `search`) consistent across `tools.ts`, prompt, mock, and tests. `AssistantWorkspace`/`ToolExecutor`/`ToolRunResult`/`AgentDeps`/`StreamFn` names match between definitions (Tasks 2,4) and consumers (Task 6, index barrel Task 9).
- **Ordering note:** Task 3 (prompt + piModel) precedes Task 4 (agent) because the agent imports from both. Tasks 5→6→7 must run together to restore a green typecheck (contract change breaks both backends until both are updated).
- **Verify-before-assume steps:** several steps say "check with grep" where the exact existing shape must be confirmed in the real file rather than assumed — the `typebox` import specifier, real.ts's stored fields (`env`/`root`) and node imports, the api-client URL prefix, `@testing-library/react` availability, the mock's ADR field names, and `AssistantContext`'s `openDoc` type.
```
