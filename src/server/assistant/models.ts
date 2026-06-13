import type { ModelOption, ModelRegistry } from '../../shared/index';

/**
 * Project the model registry into picker options — alias + provider + concrete id only.
 * Deliberately omits provider `apiKeyEnv`/keys: this crosses the wire to the browser.
 * Sorted by alias for a stable dropdown order.
 *
 * When `env` is supplied, each option also carries `available` — whether that model's
 * provider key is set — so the UI can disable un-runnable models and tell the user which
 * key to set, instead of failing only after a request. The key *names* are never exposed:
 * only the resolved boolean. Without `env`, `available` is omitted (availability unknown).
 */
export function toModelOptions(registry: ModelRegistry, env?: NodeJS.ProcessEnv): ModelOption[] {
  return Object.entries(registry.models)
    .map(([alias, entry]): ModelOption => {
      const base: ModelOption = { alias, provider: entry.provider, id: entry.id };
      if (env) {
        const apiKeyEnv = registry.providers[entry.provider]?.apiKeyEnv;
        base.available = Boolean(apiKeyEnv && env[apiKeyEnv]);
      }
      return base;
    })
    .sort((a, b) => a.alias.localeCompare(b.alias));
}
