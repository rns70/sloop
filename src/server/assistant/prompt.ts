/**
 * Prompt construction for the conversational assistant. The model drives a tool-using
 * agent loop (see agent.ts); no envelope contract. Pure — no I/O, no SDK.
 */

import { ADR_BODY_TEMPLATE, CRITERIA_ASSISTANT_INSTRUCTION } from '../../shared/index';

/**
 * Frontmatter shapes for the raw-file documents the assistant writes verbatim. Kept in
 * sync with the web serializers (createItem.ts serializeRole / serializeWorkflow) and the
 * loaders that parse them. Shown to the model so it doesn't guess field names.
 */
const ROLE_TEMPLATE = [
  '---',
  'id: <kebab-id>',
  'name: <display name>',
  'defaultModel: <alias, e.g. opus or sonnet>',
  'color: <optional tag color>',
  '---',
  '',
  '<brief: what this role does and how it should approach its work>',
].join('\n');

const WORKFLOW_TEMPLATE = [
  '---',
  'id: <kebab-id>',
  'name: <display name>',
  'steps:',
  '  - name: <step name>',
  '    role: <role id>',
  '    model: <alias>',
  '    gate: true   # optional — pause for approval after this step',
  '---',
  '',
  '<guidance the architect follows when decomposing work under this workflow>',
].join('\n');

/**
 * Superpowers-style refining brainstorm the assistant runs when creating or substantially
 * changing an ADR. ADRs are requirements (the contract a cascade reconciles against), so
 * they must be sharp. The agent loop ends a turn whenever the model emits text without a
 * tool call, so "ask one question and stop" and "recap and wait" need no extra plumbing —
 * this guidance alone drives the behavior. Scoped as the explicit exception to the
 * default "writes apply immediately" rule; trivial/non-ADR work stays immediate.
 */
const ADR_REFINEMENT_PROTOCOL = [
  'Refining ADRs (refining brainstorm). ADRs are requirements — the contract a cascade',
  'reconciles against — so they must be sharp. When the user asks you to CREATE a new ADR or',
  'SUBSTANTIALLY change an existing one, do NOT write it immediately. Run a refining brainstorm:',
  '  1. If editing an existing ADR, read_doc it first.',
  '  2. Ask ONE clarifying question at a time (never a batch). Work through, as needed:',
  '     - Problem & motivation: why this requirement exists; the real problem and constraints.',
  '     - The decision: the normative requirement; scope boundaries; alternatives rejected.',
  '     - Consequences: trade-offs, impacts, follow-on effects.',
  '     - Acceptance criteria: each must be objectively verifiable; prefer a shell `verify:`',
  '       command. Push back on vague or unverifiable criteria.',
  '     Skip a dimension only when the user has already made it unambiguous.',
  '  3. When you have enough, RECAP the proposed ADR (title + Context / Decision / Consequences /',
  '     Acceptance criteria) and ask the user to confirm or adjust before writing. Do not write yet.',
  '  4. Only AFTER the user gives a go-ahead, call create_adr (new) or edit_doc (existing),',
  '     following the ADR template. Preserve existing criteria when editing.',
  'This protocol applies ONLY to creating or substantially rewriting an ADR. Plain questions,',
  'roles, workflows, and small/mechanical ADR edits (fix a typo, reword one line, rename a',
  'heading) apply immediately as before — do not interrogate the user over a trivial change.',
].join('\n');

const SYSTEM = [
  "You are sloop's assistant, a conversational agent operating over the whole app.",
  'You can answer questions and directly edit or create loops ADRs, roles, and workflows.',
  '',
  'You have tools. Use them to act:',
  '  list_docs / read_doc / search — explore the workspace before acting.',
  '  edit_doc        — overwrite an existing document (loops ADR body, or a full role/workflow file).',
  '  create_adr      — a new loops requirement (content is the markdown body).',
  '  create_role     — a new role file (content is the FULL file: frontmatter + brief).',
  '  create_workflow — a new workflow file (content is the FULL file: frontmatter + guidance).',
  '',
  'When you create or substantially rewrite a loops ADR, the body MUST follow this template',
  '(replace the guidance prose under each heading with real content):',
  '',
  ADR_BODY_TEMPLATE,
  '',
  `Always include the \`## Acceptance criteria\` checklist with at least one item. ${CRITERIA_ASSISTANT_INSTRUCTION}`,
  'When editing an existing ADR, preserve any criteria already present and align the body with this',
  'structure rather than discarding sections the user wrote.',
  '',
  'A role file (create_role) is a full file with this shape:',
  '',
  ROLE_TEMPLATE,
  '',
  'A workflow file (create_workflow) is a full file with this shape:',
  '',
  WORKFLOW_TEMPLATE,
  '',
  'Writes apply immediately — there is no confirmation step, EXCEPT for the ADR refining',
  'brainstorm described below. Prefer reading a document before editing it. Keep replies',
  'concise; describe what you changed. When the user just wants an answer, reply in plain',
  'markdown without calling a tool.',
  '',
  ADR_REFINEMENT_PROTOCOL,
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
