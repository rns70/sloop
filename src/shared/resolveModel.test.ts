import { describe, it, expect } from 'vitest';
import { resolveModel } from './resolveModel';
import type { ModelRegistry } from './types';

const registry: ModelRegistry = {
  models: {
    opus: { provider: 'anthropic', id: 'claude-opus-4-8' },
    haiku: { provider: 'anthropic', id: 'claude-haiku-4-5-20251001' },
    nemotron: { provider: 'nebius', id: 'nvidia/llama-3.1-nemotron-70b-instruct' },
  },
  providers: {
    anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
    nebius: { baseUrl: 'https://api.studio.nebius.ai/v1', apiKeyEnv: 'NEBIUS_API_KEY' },
  },
};

const env = {
  ANTHROPIC_API_KEY: 'sk-ant-test',
  NEBIUS_API_KEY: 'nbk-test',
} as NodeJS.ProcessEnv;

describe('resolveModel', () => {
  it('resolves an Anthropic alias to provider/id/key (no baseUrl)', () => {
    expect(resolveModel('opus', registry, env)).toEqual({
      provider: 'anthropic',
      id: 'claude-opus-4-8',
      baseUrl: undefined,
      apiKey: 'sk-ant-test',
    });
  });

  it('resolves the Nebius/Nemotron alias including its OpenAI-compatible baseUrl', () => {
    expect(resolveModel('nemotron', registry, env)).toEqual({
      provider: 'nebius',
      id: 'nvidia/llama-3.1-nemotron-70b-instruct',
      baseUrl: 'https://api.studio.nebius.ai/v1',
      apiKey: 'nbk-test',
    });
  });

  it('throws on an unknown alias', () => {
    expect(() => resolveModel('gpt-9', registry, env)).toThrow(/Unknown model alias/);
  });

  it('throws when the provider key env var is unset', () => {
    expect(() => resolveModel('nemotron', registry, {} as NodeJS.ProcessEnv)).toThrow(
      /NEBIUS_API_KEY/,
    );
  });
});
