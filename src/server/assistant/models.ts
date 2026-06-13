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
