import { CRITERIA_HEADING } from './criteriaMarkdown';

/**
 * The canonical ADR body template — the single source of truth for the shape of a
 * loops ADR body. Used to scaffold new ADRs in the web UI (createItem) and shown to
 * the assistant as the template it must follow (assistant/prompt). The title is stored
 * separately in frontmatter, so the body starts at `## Context`.
 *
 * The acceptance-criteria section uses the canonical `CRITERIA_HEADING` from
 * criteriaMarkdown.ts; criteria written under it are parsed into structured
 * `AcceptanceCriterion[]` on save. The section is left empty here on purpose — a
 * brand-new ADR has no criteria yet, so the missing-criteria warning fires until real
 * ones are added (see `bodyHasNoCriteria` / `MISSING_CRITERIA_WARNING`).
 */
export const ADR_BODY_TEMPLATE = [
  '## Context',
  '',
  'Why this requirement exists — the problem, situation, or constraints that motivate it.',
  '',
  '## Decision',
  '',
  'The requirement itself, stated normatively (what the system must do).',
  '',
  '## Consequences',
  '',
  'Trade-offs, impacts, and follow-on effects of adopting the decision.',
  '',
  CRITERIA_HEADING,
  '',
].join('\n');
