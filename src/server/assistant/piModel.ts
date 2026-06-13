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
