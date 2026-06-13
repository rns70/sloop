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
