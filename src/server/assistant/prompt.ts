import type { AssistantRequest } from '../../shared/index';

/**
 * Pure prompt construction for the global assistant. No I/O, no clock, no SDK — the model
 * call lives in `assistantService.ts`. The system prompt mandates a delimited envelope so
 * the server can parse one model turn into a typed, confirmable proposal (see `envelope.ts`).
 */

export interface AssistantDoc { relPath: string; content: string; }
export interface AssistantPromptParts { systemPrompt: string; userPrompt: string; }

/** Bound a single doc's contribution so a large databank cannot blow the context window. */
function clip(text: string, max = 6000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

const SYSTEM = [
  "You are sloop's assistant. You operate over the whole app: you can answer questions,",
  'edit an existing markdown document, or create a new databank ADR, role, or template.',
  '',
  'Reply with EXACTLY ONE envelope and nothing outside it:',
  '',
  '<action>ACTION</action>',
  '<summary>one short human sentence describing what you will do</summary>',
  '<path>workspace-relative path</path>        (omit for answer)',
  '<title>document title</title>               (create-adr only)',
  '<content>', '…the payload…', '</content>',
  '',
  'ACTION is one of:',
  '  answer         — content is the answer in markdown (no path).',
  '  edit           — content is the COMPLETE new markdown body of <path> (an existing doc).',
  '  create-adr     — a new databank requirement. path like databank/<slug>.md;',
  '                   <title> is the human title; content is the markdown body only.',
  '  create-role    — a new role file. path like .sloop/roles/<slug>.md; content is the',
  '                   FULL file: YAML frontmatter (id, name, defaultModel, optional color)',
  '                   then a blank line then the brief.',
  '  create-template — a new template file. path like .sloop/templates/<slug>.md; content is',
  '                   the FULL file: YAML frontmatter (id, name, stages: name/role/model) then',
  '                   a blank line then the guidance.',
  '',
  'Choose the single best action for the request. Use the provided context documents when',
  'relevant. Never wrap <content> in code fences. Never add commentary outside the envelope.',
].join('\n');

export function buildAssistantPrompt(req: AssistantRequest, docs: AssistantDoc[]): AssistantPromptParts {
  const instruction = req.instruction.trim();
  const contextBlock = docs.length
    ? `Context documents:\n${docs.map((d) => `### ${d.relPath}\n"""\n${clip(d.content)}\n"""`).join('\n\n')}\n\n`
    : '';
  return { systemPrompt: SYSTEM, userPrompt: `${contextBlock}Instruction: ${instruction}` };
}

/**
 * Pick the registry alias to run on: explicit per-request model, then SLOOP_ASSISTANT_MODEL,
 * then the configured `fallback`, then (if absent) the first alias. An explicit/env alias is
 * honored verbatim — `resolveModel` validates and throws loudly if unknown (fail fast).
 */
export function pickAssistantAlias(
  req: AssistantRequest, env: NodeJS.ProcessEnv,
  registry: { models: Record<string, unknown> }, fallback = 'sonnet',
): string {
  const explicit = req.model?.trim() || env.SLOOP_ASSISTANT_MODEL?.trim();
  if (explicit) return explicit;
  if (registry.models[fallback]) return fallback;
  const first = Object.keys(registry.models)[0];
  if (!first) throw new Error('assistant: model registry is empty; cannot resolve a default model.');
  return first;
}
