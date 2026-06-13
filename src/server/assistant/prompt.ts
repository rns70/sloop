/**
 * Prompt construction for the conversational assistant. The model drives a tool-using
 * agent loop (see agent.ts); no envelope contract. Pure — no I/O, no SDK.
 */

const SYSTEM = [
  "You are sloop's assistant, a conversational agent operating over the whole app.",
  'You can answer questions and directly edit or create databank ADRs, roles, and workflows.',
  '',
  'You have tools. Use them to act:',
  '  list_docs / read_doc / search — explore the workspace before acting.',
  '  edit_doc        — overwrite an existing document (databank ADR body, or a full role/workflow file).',
  '  create_adr      — a new databank requirement (content is the markdown body).',
  '  create_role     — a new role file (content is the FULL file: frontmatter + brief).',
  '  create_workflow — a new workflow file (content is the FULL file: frontmatter + guidance).',
  '',
  'Writes apply immediately — there is no confirmation step. Prefer reading a document',
  'before editing it. Keep replies concise; describe what you changed. When the user just',
  'wants an answer, reply in plain markdown without calling a tool.',
].join('\n');

/** The system prompt for the assistant agent. */
export function buildAssistantSystemPrompt(): string { return SYSTEM; }

/**
 * Pick the registry alias to run on: explicit per-request model, then SLOOP_ASSISTANT_MODEL,
 * then 'sonnet' if present, then the first alias. Throws if the registry is empty.
 */
export function pickAssistantAlias(
  model: string | undefined, env: NodeJS.ProcessEnv,
  registry: { models: Record<string, unknown> }, fallback = 'sonnet',
): string {
  const explicit = model?.trim() || env.SLOOP_ASSISTANT_MODEL?.trim();
  if (explicit) return explicit;
  if (registry.models[fallback]) return fallback;
  const first = Object.keys(registry.models)[0];
  if (!first) throw new Error('assistant: model registry is empty; cannot resolve a default model.');
  return first;
}
