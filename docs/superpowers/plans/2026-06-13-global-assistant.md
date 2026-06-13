# Global Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the (currently orphaned) databank assistant into a global, app-wide assistant — a persistent right rail on every view that can answer, edit, and create databank ADRs / role / template files, every action previewed and confirmed before any write, with a provider+model picker.

**Architecture:** A single stateless `POST /api/assistant` takes `{ instruction, contextPaths, model }`, makes one pi-ai call whose prompt mandates a delimited `<action>/<path>/<content>` envelope, and returns a typed `AssistantProposal`. `GET /api/models` exposes the registry aliases (no keys) for the picker. On the web, an app-level `AssistantContext` lets the shell-mounted `AssistantRail` reuse the open editor's inline-diff for edits to the current doc; creates/edits to other docs preview in the rail and write via existing `putAdr`/`putFile`. The old doc-scoped `/api/author` stack (orphaned on this branch) is migrated out.

**Tech Stack:** TypeScript, Express, React + react-router, `@earendil-works/pi-ai`, Vitest (node env, `.ts` tests only — no web component test harness, so pure logic is TDD'd in `.ts` files; components verified via `npm run typecheck` + running app).

**Branch:** `dev-jelle`.

> ⚠️ **Shared-checkout hazard (read before starting).** This repo's agents share one git checkout; HEAD has flipped branches mid-session and concurrent agents have introduced transient red states (e.g. `listCascadeIds` missing on `FilesService` implementers, unrelated to this feature). Before starting: confirm `git branch --show-current` is `dev-jelle` and `npm run typecheck` is green on the baseline — if it is red from *other* agents' in-flight work, build this feature in an isolated `git worktree` off the clean `dev-jelle` tip and verify there. Re-check `git branch --show-current` immediately before EVERY commit.

**Build/verify:** `npm test`, `npx vitest run <file>`, `npm run typecheck`, `npm run build`, `SLOOP_MOCK=1 npm start` (deterministic mock).

**Strategy:** The new assistant stack is built additively (the old `author` stack keeps compiling and green) through Task 9; Task 12 mounts the UI and Task 13 removes the old stack in one cohesive deletion. Every task ends green.

---

## File Structure

**New (server):** `src/server/assistant/{envelope,models,prompt,assistantService,index}.ts` + tests `{envelope,models,prompt,assistantService}.test.ts`.
**New (web):** `src/web/assistant/planWrite.ts` (+ `planWrite.test.ts`), `src/web/assistant/AssistantContext.tsx`, `src/web/shell/AssistantRail.tsx`.
**Modified:** `src/shared/types.ts`, `src/server/api/{contract,mock,real}.ts`, `src/server/index.ts`, `src/web/api-client/index.ts`, `src/web/App.tsx`, `src/web/shell/AppShell.tsx`, `src/web/views/databank/AdrEditor.tsx`.
**Deleted (Task 13):** `src/web/author/*`, `src/server/author/*`, the `/api/author` route + `author()` on `SloopApi` + `AuthorRequest`/`AuthorResponse` + `requestAuthor`.

> **dev-jelle specifics this plan honors:** there is no `createItem.ts` (Task 10 ships its own `slugify`/`uniqueSlug`); `Libraries` is a single non-deep-linkable view (created roles/templates route to `/libraries`); `AdrEditor`'s route is single-segment `databank/:file` (created ADRs are top-level `databank/<id>.md`); the `src/web/author/*` assistant code exists but is not wired into any view.

---

## Task 1: Shared types (additive)

**Files:** Modify `src/shared/types.ts` (append after the `AuthorRequest` block, ~line 104).

- [ ] **Step 1: Add the types**

Append to `src/shared/types.ts` (keep `AuthorRequest` — removed in Task 13):

```ts
// ---- Global assistant (app-wide: answer / edit / create ADR|role|template) ----

/** A configured model alias surfaced to the picker. Never carries an API key. */
export interface ModelOption {
  alias: string;          // registry key, e.g. 'opus'
  provider: ProviderName;
  id: string;             // concrete provider model id
}

export type AssistantAction = 'answer' | 'edit' | 'create-adr' | 'create-role' | 'create-template';

export interface AssistantRequest {
  instruction: string;
  contextPaths: string[]; // docs loaded as context (current doc + user-attached)
  model?: string;         // registry alias from the picker
}

export interface AssistantProposal {
  action: AssistantAction;
  summary: string;        // one-line human description shown above the preview
  targetPath?: string;    // edit: doc to change; create-*: proposed path
  title?: string;         // create-adr: proposed ADR title
  content: string;        // answer text | full edited markdown | full new-file content
}
```

- [ ] **Step 2: Typecheck** — Run `npm run typecheck`. Expected: PASS (additive).
- [ ] **Step 3: Commit**

```bash
git branch --show-current   # must print dev-jelle
git add src/shared/types.ts && git commit -m "feat(types): add global assistant contract types"
```

---

## Task 2: Envelope parser (pure, TDD)

**Files:** Create `src/server/assistant/envelope.ts` + `envelope.test.ts`.

- [ ] **Step 1: Write the failing test** — create `src/server/assistant/envelope.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseEnvelope } from './envelope';

describe('parseEnvelope', () => {
  it('parses a full create-role envelope', () => {
    const raw = [
      '<action>create-role</action>',
      '<summary>Create a security-reviewer role</summary>',
      '<path>.sloop/roles/security-reviewer.md</path>',
      '<content>', '---', 'id: security-reviewer', '---', 'Reviews diffs for vulns.', '</content>',
    ].join('\n');
    const p = parseEnvelope(raw);
    expect(p.action).toBe('create-role');
    expect(p.summary).toBe('Create a security-reviewer role');
    expect(p.targetPath).toBe('.sloop/roles/security-reviewer.md');
    expect(p.content).toContain('id: security-reviewer');
    expect(p.content.endsWith('Reviews diffs for vulns.')).toBe(true);
  });

  it('parses create-adr with a title', () => {
    const raw = '<action>create-adr</action>\n<title>Token rotation</title>\n' +
      '<path>databank/token-rotation.md</path>\n<content>\nRotate every 24h.\n</content>';
    const p = parseEnvelope(raw);
    expect(p.action).toBe('create-adr');
    expect(p.title).toBe('Token rotation');
    expect(p.content.trim()).toBe('Rotate every 24h.');
  });

  it('falls back to answer when no envelope is present', () => {
    const p = parseEnvelope('Sure — here is the answer in plain prose.');
    expect(p.action).toBe('answer');
    expect(p.content).toBe('Sure — here is the answer in plain prose.');
  });

  it('falls back to answer on an unknown action', () => {
    const p = parseEnvelope('<action>delete-everything</action>\n<content>nope</content>');
    expect(p.action).toBe('answer');
    expect(p.content).toBe('nope');
  });

  it('uses the action as a default summary when none is given', () => {
    const p = parseEnvelope('<action>edit</action>\n<path>databank/a.md</path>\n<content>new body</content>');
    expect(p.action).toBe('edit');
    expect(p.summary).toBe('edit');
  });
});
```

- [ ] **Step 2: Run test, verify fail** — `npx vitest run src/server/assistant/envelope.test.ts` → FAIL "Cannot find module './envelope'".
- [ ] **Step 3: Implement** — create `src/server/assistant/envelope.ts`:

```ts
import type { AssistantAction, AssistantProposal } from '../../shared/index';

const ACTIONS: readonly AssistantAction[] = ['answer', 'edit', 'create-adr', 'create-role', 'create-template'];

/** Extract the first `<tag>…</tag>` value (non-greedy), trimmed; undefined if absent. */
function tag(raw: string, name: string): string | undefined {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i').exec(raw);
  return m ? m[1].trim() : undefined;
}

/**
 * Parse the model's delimited envelope into a typed proposal. Tolerant by design: a
 * missing/garbled envelope or an unrecognized action degrades to a plain `answer`
 * carrying the raw text — so a misbehaving model can never trigger a typed write.
 */
export function parseEnvelope(raw: string): AssistantProposal {
  const actionRaw = tag(raw, 'action')?.toLowerCase();
  const content = tag(raw, 'content');
  const action = ACTIONS.find((a) => a === actionRaw);
  if (!action || action === 'answer' || content === undefined) {
    return { action: 'answer', summary: 'answer', content: raw.trim() };
  }
  return {
    action,
    summary: tag(raw, 'summary') ?? action,
    targetPath: tag(raw, 'path'),
    title: tag(raw, 'title'),
    content,
  };
}
```

- [ ] **Step 4: Run test, verify pass** — `npx vitest run src/server/assistant/envelope.test.ts` → PASS (5).
- [ ] **Step 5: Commit** — `git add src/server/assistant/envelope.* && git commit -m "feat(assistant): tolerant envelope parser for typed proposals"`

---

## Task 3: Model options mapping (pure, TDD)

**Files:** Create `src/server/assistant/models.ts` + `models.test.ts`.

- [ ] **Step 1: Write the failing test** — create `src/server/assistant/models.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ModelRegistry } from '../../shared/index';
import { toModelOptions } from './models';

const registry: ModelRegistry = {
  models: {
    opus: { provider: 'anthropic', id: 'claude-opus-4' },
    nemotron: { provider: 'nebius', id: 'nvidia/llama-3.1-nemotron-70b-instruct' },
  },
  providers: {
    anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
    nebius: { baseUrl: 'https://api.studio.nebius.ai/v1', apiKeyEnv: 'NEBIUS_API_KEY' },
  },
};

describe('toModelOptions', () => {
  it('maps every alias to provider + id, sorted by alias, leaking no keys', () => {
    const opts = toModelOptions(registry);
    expect(opts).toEqual([
      { alias: 'nemotron', provider: 'nebius', id: 'nvidia/llama-3.1-nemotron-70b-instruct' },
      { alias: 'opus', provider: 'anthropic', id: 'claude-opus-4' },
    ]);
    expect(JSON.stringify(opts)).not.toContain('API_KEY');
  });

  it('returns [] for an empty registry', () => {
    expect(toModelOptions({ models: {}, providers: registry.providers })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test, verify fail** — `npx vitest run src/server/assistant/models.test.ts` → FAIL "Cannot find module './models'".
- [ ] **Step 3: Implement** — create `src/server/assistant/models.ts`:

```ts
import type { ModelOption, ModelRegistry } from '../../shared/index';

/**
 * Project the model registry into picker options — alias + provider + concrete id only.
 * Deliberately omits provider `apiKeyEnv`/keys: this crosses the wire to the browser.
 * Sorted by alias for a stable dropdown order.
 */
export function toModelOptions(registry: ModelRegistry): ModelOption[] {
  return Object.entries(registry.models)
    .map(([alias, entry]) => ({ alias, provider: entry.provider, id: entry.id }))
    .sort((a, b) => a.alias.localeCompare(b.alias));
}
```

- [ ] **Step 4: Run test, verify pass** — → PASS (2).
- [ ] **Step 5: Commit** — `git add src/server/assistant/models.* && git commit -m "feat(assistant): map model registry to keyless picker options"`

---

## Task 4: Assistant prompt builder (pure, TDD)

**Files:** Create `src/server/assistant/prompt.ts` + `prompt.test.ts`.

- [ ] **Step 1: Write the failing test** — create `src/server/assistant/prompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { AssistantRequest } from '../../shared/index';
import { buildAssistantPrompt, pickAssistantAlias, type AssistantDoc } from './prompt';

const req: AssistantRequest = { instruction: 'make a security-reviewer role', contextPaths: ['databank/adr-007.md'] };
const docs: AssistantDoc[] = [{ relPath: 'databank/adr-007.md', content: '# Token rotation' }];

describe('buildAssistantPrompt', () => {
  it('documents the envelope format and every action in the system prompt', () => {
    const { systemPrompt } = buildAssistantPrompt(req, docs);
    for (const t of ['<action>', '<content>', 'create-adr', 'create-role', 'create-template', 'edit', 'answer']) {
      expect(systemPrompt).toContain(t);
    }
  });
  it('includes the instruction and the context docs in the user prompt', () => {
    const { userPrompt } = buildAssistantPrompt(req, docs);
    expect(userPrompt).toContain('make a security-reviewer role');
    expect(userPrompt).toContain('databank/adr-007.md');
    expect(userPrompt).toContain('# Token rotation');
  });
  it('clips an oversized doc body', () => {
    const big = [{ relPath: 'databank/big.md', content: 'x'.repeat(9000) }];
    expect(buildAssistantPrompt(req, big).userPrompt).toContain('truncated');
  });
});

describe('pickAssistantAlias', () => {
  const registry = { models: { opus: {}, sonnet: {} } };
  it('prefers the explicit request model', () => {
    expect(pickAssistantAlias({ ...req, model: 'opus' }, {}, registry, 'sonnet')).toBe('opus');
  });
  it('falls back to the configured default when present', () => {
    expect(pickAssistantAlias(req, {}, registry, 'sonnet')).toBe('sonnet');
  });
  it('falls back to the first alias when the default is absent', () => {
    expect(pickAssistantAlias(req, {}, { models: { haiku: {} } }, 'sonnet')).toBe('haiku');
  });
  it('honors the SLOOP_ASSISTANT_MODEL env override', () => {
    expect(pickAssistantAlias(req, { SLOOP_ASSISTANT_MODEL: 'opus' }, registry, 'sonnet')).toBe('opus');
  });
});
```

- [ ] **Step 2: Run test, verify fail** — → FAIL "Cannot find module './prompt'".
- [ ] **Step 3: Implement** — create `src/server/assistant/prompt.ts`:

```ts
import type { AssistantRequest } from '../../shared/index';

/**
 * Pure prompt construction for the global assistant. No I/O, no clock, no SDK — the model
 * call lives in `assistantService.ts`. The system prompt mandates a delimited envelope so
 * the server can parse one model turn into a typed, confirmable proposal (see `envelope.ts`).
 */

export interface AssistantDoc { relPath: string; content: string; }
export interface AssistantPromptParts { systemPrompt: string; userPrompt: string; }

/** Bound a single doc's contribution so a large databank cannot blow the context window. */
function clip(text: string, max = 6000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

const SYSTEM = [
  "You are sloop's assistant. You operate over the whole app: you can answer questions,",
  'edit an existing markdown document, or create a new databank ADR, role, or template.',
  '',
  'Reply with EXACTLY ONE envelope and nothing outside it:',
  '',
  '<action>ACTION</action>',
  '<summary>one short human sentence describing what you will do</summary>',
  '<path>workspace-relative path</path>        (omit for answer)',
  '<title>document title</title>               (create-adr only)',
  '<content>', '…the payload…', '</content>',
  '',
  'ACTION is one of:',
  '  answer         — content is the answer in markdown (no path).',
  '  edit           — content is the COMPLETE new markdown body of <path> (an existing doc).',
  '  create-adr     — a new databank requirement. path like databank/<slug>.md;',
  '                   <title> is the human title; content is the markdown body only.',
  '  create-role    — a new role file. path like .sloop/roles/<slug>.md; content is the',
  '                   FULL file: YAML frontmatter (id, name, defaultModel, optional color)',
  '                   then a blank line then the brief.',
  '  create-template — a new template file. path like .sloop/templates/<slug>.md; content is',
  '                   the FULL file: YAML frontmatter (id, name, stages: name/role/model) then',
  '                   a blank line then the guidance.',
  '',
  'Choose the single best action for the request. Use the provided context documents when',
  'relevant. Never wrap <content> in code fences. Never add commentary outside the envelope.',
].join('\n');

export function buildAssistantPrompt(req: AssistantRequest, docs: AssistantDoc[]): AssistantPromptParts {
  const instruction = req.instruction.trim();
  const contextBlock = docs.length
    ? `Context documents:\n${docs.map((d) => `### ${d.relPath}\n"""\n${clip(d.content)}\n"""`).join('\n\n')}\n\n`
    : '';
  return { systemPrompt: SYSTEM, userPrompt: `${contextBlock}Instruction: ${instruction}` };
}

/**
 * Pick the registry alias to run on: explicit per-request model, then SLOOP_ASSISTANT_MODEL,
 * then the configured `fallback`, then (if absent) the first alias. An explicit/env alias is
 * honored verbatim — `resolveModel` validates and throws loudly if unknown (fail fast).
 */
export function pickAssistantAlias(
  req: AssistantRequest, env: NodeJS.ProcessEnv,
  registry: { models: Record<string, unknown> }, fallback = 'sonnet',
): string {
  const explicit = req.model?.trim() || env.SLOOP_ASSISTANT_MODEL?.trim();
  if (explicit) return explicit;
  if (registry.models[fallback]) return fallback;
  const first = Object.keys(registry.models)[0];
  if (!first) throw new Error('assistant: model registry is empty; cannot resolve a default model.');
  return first;
}
```

- [ ] **Step 4: Run test, verify pass** — → PASS (7).
- [ ] **Step 5: Commit** — `git add src/server/assistant/prompt.* && git commit -m "feat(assistant): system prompt + alias selection"`

---

## Task 5: Assistant service + barrel (TDD)

**Files:** Create `src/server/assistant/assistantService.ts`, `index.ts` + `assistantService.test.ts`.

- [ ] **Step 1: Write the failing test** — create `src/server/assistant/assistantService.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { ModelRegistry } from '../../shared/index';
import type { AssistantFiles, AssistantModelCall } from './assistantService';
import { createAssistantService } from './assistantService';

const registry: ModelRegistry = {
  models: { sonnet: { provider: 'anthropic', id: 'claude-sonnet-4-6' } },
  providers: {
    anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
    nebius: { baseUrl: 'https://api.studio.nebius.ai/v1', apiKeyEnv: 'NEBIUS_API_KEY' },
  },
};
const env: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: 'k' };
const DOCS: Record<string, string> = { 'databank/adr-007.md': '# Token rotation' };
function fakeFiles(): AssistantFiles {
  return {
    readAdr: async (relPath: string) => {
      const body = DOCS[relPath];
      if (body === undefined) throw new Error(`not found: ${relPath}`);
      return { body };
    },
    readModelRegistry: async () => registry,
  };
}
const make = (call: AssistantModelCall) => createAssistantService({ files: fakeFiles(), env, call });

describe('assistantService', () => {
  it('returns a typed create-role proposal from an envelope', async () => {
    const svc = make(async () =>
      '<action>create-role</action>\n<path>.sloop/roles/sec.md</path>\n<content>---\nid: sec\n---\nbrief</content>');
    const p = await svc.assistant({ instruction: 'make a role', contextPaths: [] });
    expect(p.action).toBe('create-role');
    expect(p.targetPath).toBe('.sloop/roles/sec.md');
    expect(p.content).toContain('id: sec');
  });
  it('passes loaded context docs into the model call', async () => {
    let seenUser = '';
    const svc = make(async (_r, parts) => { seenUser = parts.userPrompt; return '<action>answer</action>\n<content>ok</content>'; });
    await svc.assistant({ instruction: 'summarize', contextPaths: ['databank/adr-007.md'] });
    expect(seenUser).toContain('# Token rotation');
  });
  it('degrades to answer when a context doc cannot be read', async () => {
    const svc = make(async () => '<action>answer</action>\n<content>fine</content>');
    const p = await svc.assistant({ instruction: 'x', contextPaths: ['databank/missing.md'] });
    expect(p.action).toBe('answer');
    expect(p.content).toBe('fine');
  });
  it('throws on an empty instruction', async () => {
    const svc = make(async () => '<action>answer</action>\n<content>x</content>');
    await expect(svc.assistant({ instruction: '  ', contextPaths: [] })).rejects.toThrow(/instruction/);
  });
  it('throws when the model returns empty content', async () => {
    const svc = make(async () => '<action>answer</action>\n<content></content>');
    await expect(svc.assistant({ instruction: 'x', contextPaths: [] })).rejects.toThrow(/empty/);
  });
});
```

- [ ] **Step 2: Run test, verify fail** — → FAIL "Cannot find module './assistantService'".
- [ ] **Step 3: Implement** — create `src/server/assistant/assistantService.ts`:

```ts
import { complete } from '@earendil-works/pi-ai';
import type { Api, Context, Model } from '@earendil-works/pi-ai';
import type { AssistantProposal, AssistantRequest, ModelRegistry, ResolvedModel } from '../../shared/index';
import { resolveModel } from '../../shared/index';
import { parseEnvelope } from './envelope';
import { buildAssistantPrompt, pickAssistantAlias, type AssistantDoc, type AssistantPromptParts } from './prompt';

/**
 * The global assistant service — the logic behind `POST /api/assistant`. Loads context
 * docs, builds the envelope-mandating prompt, resolves the alias through the registry,
 * calls the model provider-agnostically via pi-ai, and parses the reply into a typed
 * `AssistantProposal`. Never writes: the rail previews the proposal before any write.
 */

export interface AssistantFiles {
  readAdr(relPath: string): Promise<{ body: string; title?: string }>;
  readModelRegistry(): Promise<ModelRegistry>;
}
export type AssistantModelCall = (resolved: ResolvedModel, parts: AssistantPromptParts) => Promise<string>;
export interface AssistantDeps {
  files: AssistantFiles;
  env?: NodeJS.ProcessEnv;
  call?: AssistantModelCall;
  defaultModel?: string;
}
export interface AssistantService { assistant(req: AssistantRequest): Promise<AssistantProposal>; }

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

const piAssistantCall: AssistantModelCall = async (resolved, parts) => {
  const model = toPiModel(resolved);
  const context: Context = { systemPrompt: parts.systemPrompt,
    messages: [{ role: 'user', content: parts.userPrompt, timestamp: Date.now() }] };
  const message = await complete(model, context, { apiKey: resolved.apiKey, maxTokens: 4_096 });
  return message.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text).join('\n').trim();
};

/** Load context docs, fail-soft per doc (an unreadable doc is skipped, not fatal). */
async function loadDocs(files: AssistantFiles, paths: string[]): Promise<AssistantDoc[]> {
  const loaded = await Promise.all(paths.map(async (relPath) => {
    try { const adr = await files.readAdr(relPath); return { relPath, content: adr.body } as AssistantDoc; }
    catch { return null; }
  }));
  return loaded.filter((d): d is AssistantDoc => d !== null);
}

export function createAssistantService(deps: AssistantDeps): AssistantService {
  const env = deps.env ?? process.env;
  const call = deps.call ?? piAssistantCall;
  const fallback = deps.defaultModel ?? 'sonnet';
  return {
    async assistant(req: AssistantRequest): Promise<AssistantProposal> {
      if (!req.instruction || !req.instruction.trim()) throw new Error('assistant: instruction is required.');
      const docs = await loadDocs(deps.files, req.contextPaths ?? []);
      const registry = await deps.files.readModelRegistry();
      const alias = pickAssistantAlias(req, env, registry, fallback);
      const resolved = resolveModel(alias, registry, env);
      const parts = buildAssistantPrompt(req, docs);
      const raw = (await call(resolved, parts)).trim();
      const proposal = parseEnvelope(raw);
      if (!proposal.content.trim()) throw new Error(`assistant: model "${resolved.id}" returned an empty proposal.`);
      return proposal;
    },
  };
}
```

Create `src/server/assistant/index.ts`:

```ts
// Global assistant — server side. One pi-ai call returning a delimited envelope, parsed
// into a typed proposal (answer/edit/create-*). The logic behind `POST /api/assistant`.
export {
  createAssistantService, toPiModel,
  type AssistantService, type AssistantDeps, type AssistantFiles, type AssistantModelCall,
} from './assistantService';
export { buildAssistantPrompt, pickAssistantAlias, type AssistantDoc, type AssistantPromptParts } from './prompt';
export { parseEnvelope } from './envelope';
export { toModelOptions } from './models';
```

- [ ] **Step 4: Run test, verify pass** — → PASS (5).
- [ ] **Step 5: Commit** — `git add src/server/assistant/assistantService.ts src/server/assistant/index.ts src/server/assistant/assistantService.test.ts && git commit -m "feat(assistant): service that parses a model turn into a typed proposal"`

---

## Task 6: Contract — add `listModels` + `assistant` (additive)

**Files:** Modify `src/server/api/contract.ts`.

- [ ] **Step 1: Edit the contract**

1. Add `AssistantRequest, AssistantProposal, ModelOption` to the `import type { … } from '../../shared/index'` block.
2. Add near `AuthorResponse`:

```ts
export type GetModelsResponse = ModelOption[];
/** POST /api/assistant — global assistant (answer/edit/create-*). Returns a typed
 *  proposal the rail previews; never writes. */
export type AssistantRequestBody = AssistantRequest;
export type AssistantResponse = AssistantProposal;
```

3. Add to the `SloopApi` interface (keep `author` for now):

```ts
  /** Configured model aliases for the picker (no API keys). */
  listModels(): Promise<GetModelsResponse>;
  /** Global assistant: returns a typed proposal, never writes. */
  assistant(req: AssistantRequest): Promise<AssistantResponse>;
```

- [ ] **Step 2: Typecheck (expected FAIL until Task 7)** — `npm run typecheck` fails: `MockApi`/`RealApi` don't implement the new methods yet. Do not commit until Task 7.

---

## Task 7: Implement `listModels` + `assistant` on mock and real

**Files:** Modify `src/server/api/mock.ts`, `src/server/api/real.ts`.

- [ ] **Step 1: Mock**

In `src/server/api/mock.ts`: add `import { toModelOptions } from '../assistant/index';`; add `AssistantRequest` to the shared import and `AssistantResponse, GetModelsResponse` to the contract import. Add to `class MockApi` (after `author`):

```ts
  async listModels(): Promise<GetModelsResponse> {
    return toModelOptions(this.registry);
  }

  /**
   * Deterministic stand-in for the real pi-ai assistant (WP-6 swaps in createAssistantService).
   * Keyword-routes the instruction to a plausible typed proposal so the rail's preview +
   * confirm + write flow can be exercised end to end against the mock — never writes itself.
   */
  async assistant(req: AssistantRequest): Promise<AssistantResponse> {
    const text = req.instruction.trim();
    const lower = text.toLowerCase();
    if (lower.includes('role')) {
      const slug = 'security-reviewer';
      return { action: 'create-role', summary: `Create role at .sloop/roles/${slug}.md`,
        targetPath: `.sloop/roles/${slug}.md`,
        content: `---\nid: ${slug}\nname: Security Reviewer\ndefaultModel: opus\n---\n\n${text}\n` };
    }
    if (lower.includes('template')) {
      const slug = 'review-pipeline';
      return { action: 'create-template', summary: `Create template at .sloop/templates/${slug}.md`,
        targetPath: `.sloop/templates/${slug}.md`,
        content: `---\nid: ${slug}\nname: Review Pipeline\nstages:\n  - name: architect\n    role: architect\n    model: opus\n---\n\n${text}\n` };
    }
    if (lower.includes('adr') || lower.includes('requirement') || lower.includes('document')) {
      return { action: 'create-adr', summary: 'Create a new databank ADR',
        targetPath: 'databank/untitled.md', title: 'Untitled requirement', content: `\n${text}\n` };
    }
    const primary = this.adrs.find((a) => a.relPath === req.contextPaths[0]);
    if (primary) {
      return { action: 'edit', summary: `Edit ${primary.relPath}`, targetPath: primary.relPath,
        content: `${primary.body}\n\n_Assistant: ${text}_` };
    }
    return { action: 'answer', summary: 'Answer', content: `(mock answer) ${text}` };
  }
```

- [ ] **Step 2: Real**

In `src/server/api/real.ts`:
1. Replace the author import with `import { createAssistantService, toModelOptions, type AssistantService } from '../assistant/index';`.
2. In `RealApi.create`, replace `const authorService = createAuthorService({ files, env });` with `const assistantService = createAssistantService({ files, env });` and pass it through. Rename the stored field/ctor param from author→assistant (type `AssistantService`). (The existing `author` method/field may stay until Task 13, or be renamed now — renaming now is cleaner.)
3. Add `AssistantRequest` to the shared import and `AssistantResponse, GetModelsResponse` to the contract import. Add to `RealApi` (next to `author`):

```ts
  async listModels(): Promise<GetModelsResponse> {
    return toModelOptions(await this.files.readModelRegistry());
  }
  async assistant(req: AssistantRequest): Promise<AssistantResponse> {
    return this.assistantService.assistant(req);
  }
```

> Note: until Task 13 both `author` and `assistant` coexist — intentional to keep the build green.

- [ ] **Step 3: Typecheck + suite** — `npm run typecheck && npm test` → PASS.
- [ ] **Step 4: Commit (Tasks 6+7)** — re-check branch, then `git add src/server/api/contract.ts src/server/api/mock.ts src/server/api/real.ts && git commit -m "feat(assistant): wire listModels + assistant on mock and real backends"`

---

## Task 8: Server routes — `GET /api/models`, `POST /api/assistant`

**Files:** Modify `src/server/index.ts`.

- [ ] **Step 1: Add routes** — immediately after `app.post('/api/author', …)`:

```ts
  app.get('/api/models', h(async (_req, res) => res.json(await api.listModels())));
  app.post('/api/assistant', h(async (req, res) => res.json(await api.assistant(req.body))));
```

- [ ] **Step 2: Smoke test the mock**

Run `SLOOP_MOCK=1 npm start`; in another shell:

```bash
curl -s localhost:5174/api/models
curl -s -X POST localhost:5174/api/assistant -H 'content-type: application/json' \
  -d '{"instruction":"make a security-reviewer role","contextPaths":[]}'
```

Expected: array of `{alias,provider,id}`; then a `create-role` proposal with `targetPath:".sloop/roles/security-reviewer.md"`. Ctrl-C.

- [ ] **Step 3: Commit** — `git add src/server/index.ts && git commit -m "feat(assistant): expose /api/models and /api/assistant routes"`

---

## Task 9: API client — `getModels` + `requestAssistant` (additive)

**Files:** Modify `src/web/api-client/index.ts`.

- [ ] **Step 1: Add bindings** — add `AssistantRequest, AssistantProposal, ModelOption` to the shared value+type import and re-export blocks, `AssistantResponse, GetModelsResponse` to the contract import; then after `requestAuthor`:

```ts
/** Global assistant: configured model aliases for the picker (no keys). */
export const getModels = (): Promise<ModelOption[]> => http('/models');

/** Global assistant: ask for a typed proposal (answer/edit/create-*). Never writes —
 *  the rail previews it and confirms before any putAdr/putFile. */
export const requestAssistant = (req: AssistantRequest): Promise<AssistantProposal> =>
  http('/assistant', { method: 'POST', body: JSON.stringify(req) });
```

- [ ] **Step 2: Typecheck** — PASS.
- [ ] **Step 3: Commit** — `git add src/web/api-client/index.ts && git commit -m "feat(assistant): client bindings for /api/models and /api/assistant"`

---

## Task 10: `planWrite` — proposal → collision-safe write plan (pure, TDD)

**Files:** Create `src/web/assistant/planWrite.ts` + `planWrite.test.ts`. (Self-contained `slugify`/`uniqueSlug` — no `createItem.ts` on this branch.)

- [ ] **Step 1: Write the failing test** — create `src/web/assistant/planWrite.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { AssistantProposal } from '../api-client/index';
import { planWrite, slugify, uniqueSlug } from './planWrite';

const existing = { adrPaths: ['databank/auth.md'], roleIds: ['architect'], templateIds: ['default'] };

describe('slug helpers', () => {
  it('slugifies a display name', () => {
    expect(slugify('Rate Limiting!')).toBe('rate-limiting');
    expect(slugify('  ')).toBe('untitled');
  });
  it('uniquifies against taken names', () => {
    expect(uniqueSlug('auth', new Set(['auth']))).toBe('auth-2');
    expect(uniqueSlug('new', new Set())).toBe('new');
  });
});

describe('planWrite', () => {
  it('plans an answer with no write', () => {
    const p: AssistantProposal = { action: 'answer', summary: 's', content: 'hello' };
    expect(planWrite(p, existing)).toEqual({ kind: 'answer', text: 'hello' });
  });
  it('plans an edit to the target path', () => {
    const p: AssistantProposal = { action: 'edit', summary: 's', targetPath: 'databank/auth.md', content: 'new body' };
    expect(planWrite(p, existing)).toEqual({ kind: 'edit', relPath: 'databank/auth.md', content: 'new body' });
  });
  it('plans a create-adr, building an AdrDoc and uniquifying a colliding slug', () => {
    const p: AssistantProposal = { action: 'create-adr', summary: 's', targetPath: 'databank/auth.md', title: 'Auth', content: 'body' };
    const plan = planWrite(p, existing);
    if (plan.kind !== 'create-adr') throw new Error('wrong kind');
    expect(plan.relPath).toBe('databank/auth-2.md');
    expect(plan.doc).toEqual({ id: 'auth-2', relPath: 'databank/auth-2.md', title: 'Auth', body: 'body', acceptanceCriteria: [] });
  });
  it('plans a create-role as a raw file with a unique id', () => {
    const p: AssistantProposal = { action: 'create-role', summary: 's', targetPath: '.sloop/roles/architect.md', content: '---\nid: architect\n---\nbrief' };
    expect(planWrite(p, existing)).toEqual({ kind: 'create-file', relPath: '.sloop/roles/architect-2.md', content: '---\nid: architect\n---\nbrief', libKind: 'roles' });
  });
  it('plans a create-template under .sloop/templates', () => {
    const p: AssistantProposal = { action: 'create-template', summary: 's', targetPath: '.sloop/templates/ci.md', content: 'tpl' };
    const plan = planWrite(p, existing);
    if (plan.kind !== 'create-file') throw new Error('wrong kind');
    expect(plan.relPath).toBe('.sloop/templates/ci.md');
    expect(plan.libKind).toBe('templates');
  });
  it('derives an ADR slug from the title when targetPath is missing', () => {
    const p: AssistantProposal = { action: 'create-adr', summary: 's', title: 'Rate Limiting!', content: 'b' };
    const plan = planWrite(p, existing);
    if (plan.kind !== 'create-adr') throw new Error('wrong kind');
    expect(plan.relPath).toBe('databank/rate-limiting.md');
  });
});
```

- [ ] **Step 2: Run test, verify fail** — → FAIL "Cannot find module './planWrite'".
- [ ] **Step 3: Implement** — create `src/web/assistant/planWrite.ts`:

```ts
import type { AdrDoc, AssistantProposal } from '../api-client/index';

/** kebab-case a display name into a filename-safe id; never empty. */
export function slugify(name: string): string {
  const s = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'untitled';
}

/** First of `base`, `base-2`, `base-3`, … not already in `taken`. */
export function uniqueSlug(base: string, taken: Set<string>): string {
  const b = slugify(base);
  if (!taken.has(b)) return b;
  for (let i = 2; ; i += 1) {
    const candidate = `${b}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** What the rail should do once the user confirms a proposal. */
export type WritePlan =
  | { kind: 'answer'; text: string }
  | { kind: 'edit'; relPath: string; content: string }
  | { kind: 'create-adr'; relPath: string; doc: AdrDoc }
  | { kind: 'create-file'; relPath: string; content: string; libKind: 'roles' | 'templates' };

export interface ExistingIds { adrPaths: string[]; roleIds: string[]; templateIds: string[]; }

/** basename without extension, e.g. 'databank/x/auth.md' -> 'auth'. */
function baseId(path: string | undefined): string {
  if (!path) return '';
  return (path.split('/').pop() ?? '').replace(/\.md$/, '');
}

/**
 * Turn a typed proposal into a concrete, collision-safe write plan. The model proposes a
 * path/slug; this guarantees uniqueness against what already exists so a create never
 * silently clobbers a file.
 */
export function planWrite(p: AssistantProposal, existing: ExistingIds): WritePlan {
  if (p.action === 'answer') return { kind: 'answer', text: p.content };
  if (p.action === 'edit') return { kind: 'edit', relPath: p.targetPath ?? '', content: p.content };

  if (p.action === 'create-adr') {
    const base = baseId(p.targetPath) || slugify(p.title ?? 'untitled');
    const id = uniqueSlug(base, new Set(existing.adrPaths.map(baseId)));
    const relPath = `databank/${id}.md`;
    return { kind: 'create-adr', relPath, doc: { id, relPath, title: p.title ?? 'Untitled', body: p.content, acceptanceCriteria: [] } };
  }

  const libKind: 'roles' | 'templates' = p.action === 'create-role' ? 'roles' : 'templates';
  const base = baseId(p.targetPath) || slugify(p.summary || libKind);
  const id = uniqueSlug(base, new Set(libKind === 'roles' ? existing.roleIds : existing.templateIds));
  return { kind: 'create-file', relPath: `.sloop/${libKind}/${id}.md`, content: p.content, libKind };
}
```

- [ ] **Step 4: Run test, verify pass** — → PASS (9).
- [ ] **Step 5: Commit** — `git add src/web/assistant/planWrite.* && git commit -m "feat(assistant): collision-safe write planner for proposals"`

---

## Task 11: `AssistantContext` provider + `useAssistant`

**Files:** Create `src/web/assistant/AssistantContext.tsx`.

- [ ] **Step 1: Write the provider**

```tsx
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * The open editor (if any) registers itself here so the shell-mounted AssistantRail can:
 *  - auto-include the current doc as context, and
 *  - hand an edit of THAT doc back to the editor's inline accept/reject diff (`applyInline`)
 *    instead of writing through the API.
 */
export interface OpenDoc {
  relPath: string;
  getValue: () => string;
  applyInline: (originalText: string, replacement: string) => void;
}

interface AssistantContextValue {
  openDoc: OpenDoc | null;
  registerOpenDoc: (doc: OpenDoc | null) => void;
}

const Ctx = createContext<AssistantContextValue | null>(null);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [openDoc, setOpenDoc] = useState<OpenDoc | null>(null);
  const registerOpenDoc = useCallback((doc: OpenDoc | null) => setOpenDoc(doc), []);
  const value = useMemo(() => ({ openDoc, registerOpenDoc }), [openDoc, registerOpenDoc]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAssistant(): AssistantContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAssistant must be used within an AssistantProvider');
  return ctx;
}
```

- [ ] **Step 2: Typecheck** — PASS.
- [ ] **Step 3: Commit** — `git add src/web/assistant/AssistantContext.tsx && git commit -m "feat(assistant): app-level context for open-doc handoff"`

---

## Task 12: `AssistantRail` component

**Files:** Create `src/web/shell/AssistantRail.tsx`.

- [ ] **Step 1: Write the rail**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getAdrs, getModels, getRoles, getTemplates, putAdr, putFile, requestAssistant,
  type AssistantProposal, type ModelOption,
} from '../api-client/index';
import { Button, Label, cx } from '../design/index';
import { useAssistant } from '../assistant/AssistantContext';
import { planWrite, type ExistingIds } from '../assistant/planWrite';

/** Read the current live id/path sets for collision-safe creates. */
async function loadExisting(): Promise<ExistingIds> {
  const [adrs, roles, templates] = await Promise.all([getAdrs(), getRoles(), getTemplates()]);
  return {
    adrPaths: adrs.map((a) => a.relPath),
    roleIds: roles.map((r) => r.id),
    templateIds: templates.map((t) => t.id),
  };
}

export function AssistantRail({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { openDoc } = useAssistant();

  const [models, setModels] = useState<ModelOption[]>([]);
  const [alias, setAlias] = useState('');
  const [instruction, setInstruction] = useState('');
  const [proposal, setProposal] = useState<AssistantProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    getModels()
      .then((opts) => { setModels(opts); setAlias((a) => a || opts[0]?.alias || ''); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const contextPaths = useMemo(() => (openDoc ? [openDoc.relPath] : []), [openDoc]);

  async function run() {
    const text = instruction.trim();
    if (!text || busy) return;
    setBusy(true); setError(null); setNote(null); setProposal(null);
    try {
      setProposal(await requestAssistant({ instruction: text, contextPaths, model: alias || undefined }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function confirm() {
    if (!proposal || busy) return;
    setBusy(true); setError(null);
    try {
      // Edit of the doc open in the editor → inline accept/reject diff (no API write).
      if (proposal.action === 'edit' && openDoc && proposal.targetPath === openDoc.relPath) {
        openDoc.applyInline(openDoc.getValue(), proposal.content);
        setNote('Applied as an inline diff in the editor.');
        setProposal(null); setInstruction('');
        return;
      }
      const plan = planWrite(proposal, await loadExisting());
      if (plan.kind === 'edit') {
        const adr = (await getAdrs()).find((a) => a.relPath === plan.relPath);
        if (!adr) throw new Error(`Cannot edit unknown doc: ${plan.relPath}`);
        await putAdr(plan.relPath, { ...adr, body: plan.content });
        navigate(`/databank/${plan.relPath.replace(/^databank\//, '')}`);
      } else if (plan.kind === 'create-adr') {
        await putAdr(plan.relPath, plan.doc);
        navigate(`/databank/${plan.relPath.replace(/^databank\//, '')}`);
      } else if (plan.kind === 'create-file') {
        await putFile(plan.relPath, plan.content);
        navigate('/libraries');
      }
      setProposal(null); setInstruction('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  const isAnswer = proposal?.action === 'answer';

  return (
    <aside className={cx('flex w-80 shrink-0 flex-col border-l border-line-hair bg-sidebar px-4 py-3 text-[13px]', className)}>
      <Label>Assistant</Label>

      <div className="mt-2">
        <select
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          disabled={models.length === 0}
          className="w-full rounded border border-line-soft bg-paper px-2 py-1 text-[12px] text-ink-muted outline-none focus:border-accent disabled:opacity-60"
        >
          {models.length === 0 ? (
            <option value="">No models configured (.sloop/config.md)</option>
          ) : (
            models.map((m) => (
              <option key={m.alias} value={m.alias}>{m.alias} — {m.provider} / {m.id}</option>
            ))
          )}
        </select>
      </div>

      <div className="mt-2 text-[11px] text-ink-faint">
        {openDoc ? `Context: ${openDoc.relPath}` : 'Context: none (whole app)'}
      </div>

      <textarea
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        rows={4}
        placeholder="Ask, edit a doc, or create an ADR / role / template…"
        className="mt-2 w-full resize-y rounded border border-line-soft bg-paper px-2 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent"
      />

      <div className="mt-2">
        <Button variant="primary" disabled={busy || !instruction.trim()} onClick={() => void run()}>
          {busy ? 'Working…' : 'Send'}
        </Button>
      </div>

      {error && <p className="mt-2 text-[12px] text-status-failed">{error}</p>}
      {note && <p className="mt-2 text-[12px] text-ink-faint">{note}</p>}

      {proposal && (
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-md bg-line-soft px-3 py-2">
          <div className="mb-1 text-[11px] uppercase tracking-[0.07em] text-ink-faint">
            {isAnswer ? 'Answer' : 'Proposal'}
          </div>
          {!isAnswer && <p className="mb-2 text-[12px] font-medium text-ink">{proposal.summary}</p>}
          {!isAnswer && proposal.targetPath && (
            <p className="mb-2 font-mono text-[11px] text-ink-faint">{proposal.targetPath}</p>
          )}
          <pre className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-ink">{proposal.content}</pre>
          {!isAnswer && (
            <div className="mt-2 flex gap-2">
              <Button variant="primary" disabled={busy} onClick={() => void confirm()}>
                {proposal.action === 'edit' ? 'Apply' : 'Create'}
              </Button>
              <Button variant="subtle" disabled={busy} onClick={() => setProposal(null)}>Discard</Button>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 2: Typecheck** — PASS.

> If `Button` lacks a `variant="subtle"`/`"primary"` value, open `src/web/design/Button.tsx` and use the variants it defines (the orphaned `AssistantPanel.tsx` uses `"primary"`/`"subtle"`, so both exist on this branch).

- [ ] **Step 3: Commit** — `git add src/web/shell/AssistantRail.tsx && git commit -m "feat(assistant): global right-rail UI with model picker and preview/confirm"`

---

## Task 13: Mount provider + rail; wire the editor; remove the old author stack

**Files:** `src/web/App.tsx`, `src/web/shell/AppShell.tsx`, `src/web/views/databank/AdrEditor.tsx`; delete `src/web/author/*`, `src/server/author/*`; remove author surface from `contract.ts`, `mock.ts`, `real.ts`, `server/index.ts`, `api-client/index.ts`, `shared/types.ts`.

- [ ] **Step 1: Mount the rail in `AppShell`** — add `import { AssistantRail } from './AssistantRail';` and render it as the third flex column. In `src/web/shell/AppShell.tsx`, change the `<main>` wrapper region to:

```tsx
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>

      <AssistantRail />
    </div>
```

(The outermost element is already `<div className="flex h-screen w-screen overflow-hidden …">`, so the rail becomes the third child after the left `<aside>` and `<main>`.)

- [ ] **Step 2: Wrap routing in the provider** — in `src/web/App.tsx`, import `AssistantProvider` from `./assistant/AssistantContext` and wrap `<Routes>`:

```tsx
import { AssistantProvider } from './assistant/AssistantContext';
// …
export default function App() {
  return (
    <AssistantProvider>
      <Routes>
        {/* …unchanged… */}
      </Routes>
    </AssistantProvider>
  );
}
```

- [ ] **Step 3: Register the open doc from `AdrEditor`** — in `src/web/views/databank/AdrEditor.tsx`:

1. Update imports:

```tsx
import { useEffect, useRef, useState } from 'react';
import { MarkdownEditor, type MarkdownEditorHandle } from '../../design/index';
import { useAssistant } from '../../assistant/AssistantContext';
```

(add `useRef` to the existing `react` import; add `MarkdownEditorHandle` to the existing design import.)

2. Inside the component, add a ref + registration effect (place after the existing state hooks):

```tsx
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const { registerOpenDoc } = useAssistant();

  useEffect(() => {
    registerOpenDoc({
      relPath,
      getValue: () => body,
      applyInline: (orig, repl) => editorRef.current?.applyProposal(orig, repl),
    });
    return () => registerOpenDoc(null);
  }, [relPath, body, registerOpenDoc]);
```

3. Pass the ref to the editor — change `<MarkdownEditor value={body} onChange={setBody} />` to:

```tsx
            <MarkdownEditor ref={editorRef} value={body} onChange={setBody} />
```

- [ ] **Step 4: Remove the old author endpoint (server)**

- `src/server/api/contract.ts`: remove the `author(req): Promise<AuthorResponse>` method from `SloopApi`, the `AuthorResponse` type, `AuthorRequestBody`, and the now-unused `AuthorRequest` import.
- `src/server/api/mock.ts`: remove the `author` method and the `AuthorRequest`/`AuthorResponse` imports.
- `src/server/api/real.ts`: remove the `author` method, `createAuthorService`/`AuthorService` references, and leftover author imports.
- `src/server/index.ts`: remove the `app.post('/api/author', …)` line.

- [ ] **Step 5: Remove the old author client + shared type**

- `src/web/api-client/index.ts`: remove `requestAuthor` and the `AuthorRequest`/`AuthorResponse` import+re-export.
- `src/shared/types.ts`: remove the `AuthorRequest` interface.

- [ ] **Step 6: Delete dead files**

```bash
git rm -r src/web/author src/server/author
```

- [ ] **Step 7: Verify nothing dangles**

```bash
grep -rn "AuthorRequest\|AuthorResponse\|requestAuthor\|AuthoredEditor\|AssistantPanel\|SelectionToolbar\|useAuthor\|/api/author\|createAuthorService\|\.author(" src
```

Expected: NO matches. Then `npm run typecheck && npm test && npm run build` → all PASS.

- [ ] **Step 8: Manual end-to-end (mock)**

Run `SLOOP_MOCK=1 npm run dev`. In the browser:
1. The assistant rail is visible on every view (Databank / Cascades / Libraries).
2. Picker lists configured aliases as `alias — provider / id`.
3. "make a security-reviewer role" → `create-role` preview → **Create** → lands on `/libraries`; the new role appears in the list.
4. Open an ADR, "add a paragraph about retries", **Send** → `edit` proposal targeting the open doc → **Apply** → inline accept/reject diff in the editor.
5. "what does this ADR cover?" (ADR open) → an `answer` in the rail (no write).

- [ ] **Step 9: Commit** — re-check branch, then `git add -A && git commit -m "feat(assistant): mount global rail, wire editor handoff, remove old author stack"`

---

## Task 14: Final verification

- [ ] **Step 1: Full gate** — `npm run typecheck && npm test && npm run build`. Expected: typecheck clean; vitest green (4 new server test files + planWrite); vite build succeeds.
- [ ] **Step 2: Demo path (if present)** — if `npm run verify:demo` exists on this branch, run it; expected exit 0 (cascade convergence is untouched by this work). Skip if the script is absent on `dev-jelle`.
- [ ] **Step 3: Commit** — `git add -A && git commit -m "chore(assistant): final verification pass" --allow-empty`

---

## Notes & consequences

- **Selection-scope inline rewrite is dropped** (the orphaned `SelectionToolbar`). Per the spec it is out of scope for v1; everything it did is reachable via the rail as an `edit` to the open doc (inline diff preserved through `applyInline`).
- **Created roles/templates route to `/libraries`** (not a deep link) because `Libraries` is a single non-deep-linkable view on this branch; the new file shows in the list after its on-mount refetch.
- **Statelessness:** no server-side conversation history; each Send is one independent call; the rail holds only the latest proposal.
- **Security:** `GET /api/models` returns alias/provider/id only — `toModelOptions` never includes `apiKeyEnv` or keys. Keys stay server-side, resolved per call via `resolveModel`.
- **Shared-checkout hygiene:** re-run `git branch --show-current` before every commit; if the baseline is red from other agents' in-flight work, do this feature in an isolated `git worktree` off the clean `dev-jelle` tip.
```
