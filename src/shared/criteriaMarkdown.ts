import type { AcceptanceCriterion } from './types';

/**
 * The canonical on-disk format for acceptance criteria. Criteria live as a task
 * list under a `## Acceptance criteria` heading in the markdown *body* of ADR and
 * loop files. One criterion per line:
 *
 *   - [ ] **ac-1** <text> — verify: `<shell command>` 🔒
 *
 *   `[ ]`/`[x]`  -> passed (case-insensitive)
 *   **ac-N**     -> id (stable; survives reorder/edit)
 *   — verify: `…` -> verify command (optional; en-dash/hyphen tolerated)
 *   🔒           -> locked (optional)
 *   remainder    -> text
 *
 * Flat (non-nested) single-line items are used deliberately: they survive the
 * loops editor's lossy BlockNote markdown export far more reliably than nested
 * lists or HTML comments. This module is the single source of truth for the format.
 * Note: verify commands must not contain backticks (they delimit the inline code span).
 */
export const CRITERIA_HEADING = '## Acceptance criteria';

export interface ParsedCriteria {
  criteria: AcceptanceCriterion[];
  /** The body with the criteria section removed, trimmed. */
  bodyWithoutSection: string;
  /** Whether a criteria section was present at all. */
  hasSection: boolean;
}

const HEADING_RE = /^##\s+acceptance\s+criteria\s*$/i;
const ANY_HEADING_RE = /^#{1,6}\s/;
// Bullet marker is `-`, `*`, or `+`: we write `-` to disk, but BlockNote's
// `blocksToMarkdownLossy` re-exports check lists with a `*` marker, so the live
// editor buffer arrives here with `* [ ]`. Tolerate all three CommonMark markers.
const ITEM_RE = /^\s*[-*+]\s*\[([ xX])\]\s*(.*?)\s*$/;
// Ids are usually `ac-N`, but authors (and the assistant) may use slugs like
// `ac-logic-tests`; accept either so the `**id**` marker is always parsed out of the text.
const ID_RE = /^\*\*(ac-[a-z0-9-]+)\*\*\s*/i;
const VERIFY_RE = /\s*[—–-]\s*verify:\s*`([^`]+)`\s*$/i;
const LOCKED_RE = /\s*🔒\s*$/u;

/** For each line, whether it sits inside a fenced code block (fence lines included). */
function fencedLineMask(lines: string[]): boolean[] {
  const mask: boolean[] = [];
  let fenceChar: string | null = null;
  for (const line of lines) {
    const m = line.trim().match(/^(`{3,}|~{3,})/);
    if (fenceChar === null && m) {
      fenceChar = m[1][0];
      mask.push(true);
    } else if (fenceChar !== null && m && m[1][0] === fenceChar) {
      mask.push(true);
      fenceChar = null;
    } else {
      mask.push(fenceChar !== null);
    }
  }
  return mask;
}

/** Extract the criteria section from a markdown body. */
export function parseCriteriaFromBody(body: string): ParsedCriteria {
  const lines = body.split('\n');
  const fenced = fencedLineMask(lines);

  // Find the heading, skipping lines inside fenced code blocks.
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!fenced[i] && HEADING_RE.test(lines[i].trim())) {
      start = i;
      break;
    }
  }
  if (start === -1) {
    return { criteria: [], bodyWithoutSection: body.trim(), hasSection: false };
  }

  // Find the end of the section (next non-fenced heading), skipping fenced lines.
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (!fenced[i] && ANY_HEADING_RE.test(lines[i].trim())) {
      end = i;
      break;
    }
  }

  // Parse criteria items, skipping fenced lines.
  const criteria: AcceptanceCriterion[] = [];
  for (let i = start + 1; i < end; i++) {
    if (!fenced[i]) {
      const m = lines[i].match(ITEM_RE);
      if (m) criteria.push(parseItem(m[1], m[2]));
    }
  }

  const bodyWithoutSection = [...lines.slice(0, start), ...lines.slice(end)]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { criteria, bodyWithoutSection, hasSection: true };
}

function parseItem(box: string, content: string): AcceptanceCriterion {
  let rest = content;
  let locked = false;
  if (LOCKED_RE.test(rest)) {
    locked = true;
    rest = rest.replace(LOCKED_RE, '');
  }
  let verify: string | undefined;
  const vm = rest.match(VERIFY_RE);
  if (vm) {
    verify = vm[1];
    rest = rest.replace(VERIFY_RE, '');
  }
  let id = '';
  const im = rest.match(ID_RE);
  if (im) {
    id = im[1].trim();
    rest = rest.replace(ID_RE, '');
  }
  const criterion: AcceptanceCriterion = { id, text: rest.trim(), passed: box.toLowerCase() === 'x' };
  if (verify !== undefined) criterion.verify = verify;
  if (locked) criterion.locked = true;
  return criterion;
}

/** Fill any empty/whitespace id with the next free `ac-N`. Returns a new array. */
export function assignMissingIds(criteria: AcceptanceCriterion[]): AcceptanceCriterion[] {
  let max = 0;
  for (const c of criteria) {
    const m = /^ac-(\d+)$/.exec((c.id ?? '').trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return criteria.map((c) => ((c.id ?? '').trim() ? c : { ...c, id: `ac-${++max}` }));
}

export type CriteriaStyle = 'plain' | 'full';

/** Replace (or append, or remove-if-empty) the criteria section in a body.
 *  `full` (default) emits ids + 🔒 for loops; `plain` emits a bare checklist for ADRs. */
export function upsertCriteriaInBody(
  body: string,
  criteriaIn: AcceptanceCriterion[],
  style: CriteriaStyle = 'full',
): string {
  const { bodyWithoutSection } = parseCriteriaFromBody(body);
  const base = bodyWithoutSection.trim();
  // Stable ids only matter for the structured (loop) format; plain leaves them alone.
  const criteria = style === 'full' ? assignMissingIds(criteriaIn) : criteriaIn;
  if (criteria.length === 0) return base ? `${base}\n` : '';
  const section = `${CRITERIA_HEADING}\n\n${criteria.map((c) => renderCriterion(c, style)).join('\n')}`;
  return `${base ? `${base}\n\n` : ''}${section}\n`;
}

function renderCriterion(c: AcceptanceCriterion, style: CriteriaStyle): string {
  const id = style === 'full' && c.id ? `**${c.id}** ` : '';
  let line = `- [${c.passed ? 'x' : ' '}] ${id}${c.text}`.trimEnd();
  if (c.verify) {
    if (c.verify.includes('`')) {
      throw new Error(`verify command must not contain a backtick: ${c.verify}`);
    }
    line += ` — verify: \`${c.verify}\``;
  }
  if (style === 'full' && c.locked) line += ' 🔒';
  return line;
}

/** UI copy shown when a design/loop has no acceptance criteria. Single source of truth. */
export const MISSING_CRITERIA_WARNING =
  'This design has no acceptance criteria. Add a "## Acceptance criteria" checklist so loops seeded from it can be verified.';

/** Instruction handed to the assistant by the "Add with assistant" shortcut. */
export const CRITERIA_ASSISTANT_INSTRUCTION =
  'Add a `## Acceptance criteria` section to this design as a markdown checklist. ' +
  'Each item must be objectively verifiable; where a shell command can check it, ' +
  'append " — verify: `<command>`". Base the criteria on the document\'s decision and consequences.';

/**
 * True when the markdown body carries no acceptance criteria — i.e. the section is
 * absent OR present but empty. Reuses the canonical parser, so checklist lines inside
 * fenced code blocks do not count.
 */
export function bodyHasNoCriteria(body: string): boolean {
  return parseCriteriaFromBody(body).criteria.length === 0;
}
