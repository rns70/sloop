---
models:
  opus:     { provider: anthropic, id: claude-opus-4-8 }
  sonnet:   { provider: anthropic, id: claude-sonnet-4-6 }
  haiku:    { provider: anthropic, id: claude-haiku-4-5-20251001 }
  nemotron: { provider: nebius,    id: nvidia/llama-3.1-nemotron-70b-instruct }
providers:
  anthropic: { apiKeyEnv: ANTHROPIC_API_KEY }
  nebius:    { baseUrl: https://api.studio.nebius.ai/v1, apiKeyEnv: NEBIUS_API_KEY }
depthCap: 2
defaultModel: sonnet
executor: pi
---

# sloop config

The frontmatter above is the **model registry** (`ModelRegistry` shared type) plus a
few global defaults. It is the single place a new provider or model alias is added.

## Providers
- **anthropic** — Claude models via Pi's built-in Anthropic provider. Key from `ANTHROPIC_API_KEY`.
- **nebius** — Nebius AI Studio's **OpenAI-compatible** API (hosts NVIDIA Nemotron and
  other open models). Registered with Pi via `registerProvider({ api: 'openai-completions',
  baseUrl, apiKey })`. Key from `NEBIUS_API_KEY`.

## Model aliases
A loop's `model` field is an alias resolved here to `{ provider, id }`, then to a
concrete `{ provider, id, baseUrl?, apiKey }` by `resolveModel(alias, registry, env)`.
So the architect can plan on `nemotron` and execute leaves on `haiku` — any mix.

## Other defaults
- `depthCap` — hard cap on loop-tree depth (safety for live demos; ~2 levels).
- `defaultModel` — global fallback when no per-loop / role / template model applies.
- `executor` — agent runtime backing leaf execution (Pi).
