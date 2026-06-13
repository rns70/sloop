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

  it('marks availability per provider key when env is supplied', () => {
    const opts = toModelOptions(registry, { ANTHROPIC_API_KEY: 'set' });
    const byAlias = Object.fromEntries(opts.map((o) => [o.alias, o.available]));
    expect(byAlias).toEqual({ opus: true, nemotron: false }); // only anthropic key present
  });

  it('omits availability entirely when env is not supplied', () => {
    for (const opt of toModelOptions(registry)) {
      expect(opt).not.toHaveProperty('available');
    }
  });
});
