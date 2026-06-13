import type { ResolvedModel } from './types';
import type { ResolveModel } from './services';

/**
 * Pure resolver: turn a loop's `model` alias into a concrete provider + id + key.
 *
 * Resolution: alias -> ModelEntry (provider + id) -> ProviderConfig (baseUrl + apiKeyEnv)
 * -> read the key from the provided env map. No I/O, no `process` global, no Date.now —
 * everything needed is passed in, so this stays trivially testable (WP-0 contract).
 *
 * Throws (fail fast) when the alias, the provider config, or the API-key env var is
 * missing — a misconfigured registry should surface loudly at resolve time, not as a
 * silent empty key that fails deep inside a provider call.
 */
export const resolveModel: ResolveModel = (alias, registry, env): ResolvedModel => {
  const entry = registry.models[alias];
  if (!entry) {
    const known = Object.keys(registry.models).join(', ') || '(none)';
    throw new Error(`Unknown model alias "${alias}". Known aliases: ${known}.`);
  }

  const provider = registry.providers[entry.provider];
  if (!provider) {
    throw new Error(
      `Model "${alias}" references provider "${entry.provider}", which is not configured in the registry.`,
    );
  }

  const apiKey = env[provider.apiKeyEnv];
  if (!apiKey) {
    throw new Error(
      `Missing API key for model "${alias}": env var "${provider.apiKeyEnv}" is not set.`,
    );
  }

  return {
    provider: entry.provider,
    id: entry.id,
    baseUrl: provider.baseUrl,
    apiKey,
  };
};
