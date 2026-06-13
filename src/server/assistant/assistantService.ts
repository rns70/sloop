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
