import type { AuthorRequest } from '../../shared/index';

/**
 * Pure prompt construction for the authoring assistant (Cursor-style editing of
 * databank docs). No I/O, no clock, no model SDK — so it is unit-testable directly;
 * the actual model call lives in `authorService.ts`.
 *
 * Three scopes, increasingly wide (spec §7.1):
 *  - `selection` — rewrite a selected span; the model returns ONLY the replacement.
 *  - `doc`       — apply the instruction to the whole current doc (edit or answer).
 *  - `multi`     — same, with several databank docs concatenated as context.
 *
 * Every result is surfaced to the user as an inline diff to accept or reject — the
 * prompt therefore forbids commentary/code-fences so the raw text drops straight in.
 */

/** A document loaded for context: its workspace-relative path + markdown body. */
export interface AuthorDoc {
  relPath: string;
  content: string;
}

export interface AuthorPromptParts {
  systemPrompt: string;
  userPrompt: string;
}

/** Bound a single document's contribution so a large databank cannot blow the context window. */
function clip(text: string, max = 6000): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

const SELECTION_SYSTEM =
  "You are sloop's authoring assistant, editing markdown requirement documents (ADRs). " +
  'The user has selected a span of text and wants it changed per their instruction. ' +
  'Return ONLY the replacement markdown for that span — no preamble, no explanation, ' +
  'no surrounding code fences. Preserve the surrounding markdown style and conventions.';

const DOC_SYSTEM =
  "You are sloop's authoring assistant for markdown requirement documents (ADRs). " +
  'Apply the user instruction to the document. If it asks for an edit, return the COMPLETE ' +
  'edited markdown body of the document — the full new text, with no commentary and no code ' +
  'fences. If it is a question, answer concisely in markdown.';

const MULTI_SYSTEM =
  "You are sloop's authoring assistant for markdown requirement documents (ADRs). " +
  'You are given several documents as context; the FIRST is the primary document. ' +
  'Apply the user instruction. If it asks for an edit, return the COMPLETE edited markdown body ' +
  'of the PRIMARY document only — the full new text, no commentary, no code fences. ' +
  'If it is a question, answer concisely in markdown, reasoning across all documents.';

/**
 * Build the system + user prompt for an author request. `docs` is the loaded content
 * for `req.docPaths` (for `selection`, the optional current-doc context — may be empty).
 *
 * Throws (fail fast) when `selection` scope is missing its `selectionText`.
 */
export function buildAuthorPrompt(req: AuthorRequest, docs: AuthorDoc[]): AuthorPromptParts {
  const instruction = req.instruction.trim();

  if (req.scope === 'selection') {
    if (!req.selectionText || !req.selectionText.trim()) {
      throw new Error('author: scope "selection" requires non-empty selectionText.');
    }
    const context = docs[0];
    const contextBlock = context
      ? `Document context (${context.relPath}):\n${clip(context.content)}\n\n`
      : '';
    const userPrompt =
      `${contextBlock}` +
      `The user selected this text:\n"""\n${req.selectionText}\n"""\n\n` +
      `Instruction: ${instruction}\n\n` +
      'Return only the replacement markdown for the selected text.';
    return { systemPrompt: SELECTION_SYSTEM, userPrompt };
  }

  if (req.scope === 'doc') {
    const doc = docs[0];
    const body = doc ? clip(doc.content) : '';
    const userPrompt =
      `Document (${doc?.relPath ?? 'current'}):\n"""\n${body}\n"""\n\n` +
      `Instruction: ${instruction}`;
    return { systemPrompt: DOC_SYSTEM, userPrompt };
  }

  // multi
  const blocks = docs
    .map((d, i) => `### ${i === 0 ? '[PRIMARY] ' : ''}${d.relPath}\n"""\n${clip(d.content)}\n"""`)
    .join('\n\n');
  const userPrompt = `${blocks}\n\n` + `Instruction: ${instruction}`;
  return { systemPrompt: MULTI_SYSTEM, userPrompt };
}

/**
 * Pick the registry alias to run on: an explicit per-request model wins, then the
 * `SLOOP_AUTHOR_MODEL` env override, then the configured `fallback`, then (if that
 * alias is absent) the first alias the registry defines.
 *
 * An explicit/env alias is honored verbatim — `resolveModel` validates it and throws
 * loudly if it is unknown (fail fast: the user asked for something specific). Only the
 * implicit default degrades to "first available" so a registry that lacks the default
 * alias still works for the demo.
 */
export function pickAuthorAlias(
  req: AuthorRequest,
  env: NodeJS.ProcessEnv,
  registry: { models: Record<string, unknown> },
  fallback = 'sonnet',
): string {
  const explicit = req.model?.trim() || env.SLOOP_AUTHOR_MODEL?.trim();
  if (explicit) return explicit;
  if (registry.models[fallback]) return fallback;
  const first = Object.keys(registry.models)[0];
  if (!first) {
    throw new Error('author: model registry is empty; cannot resolve a default author model.');
  }
  return first;
}
