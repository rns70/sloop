// Pure text helpers for rendering ADRs in the run panel. Unit-tested in text.test.ts.

// `upsertCriteriaInBody` injects a `## Acceptance criteria` section into ADR bodies, so
// it must never be mistaken for the document's title heading.
const CRITERIA_HEADING_RE = /^#{1,6}\s+acceptance\s+criteria\s*$/i;

/** `rotate-refresh-tokens` → `rotate refresh tokens`; strips a leading underscore. */
export function humanize(id: string): string {
  return id.replace(/^_/, '').replace(/[-_]+/g, ' ').trim();
}

/**
 * An ADR's display title for the run tree: prefer the document's own `title`, else its
 * first content heading (skipping the injected criteria section), else the humanized id.
 */
export function adrTitle(id: string, title: string, body: string): string {
  if (title.trim()) return title.trim();
  const firstHeading = body
    .split('\n')
    .find((line) => /^#+\s/.test(line) && !CRITERIA_HEADING_RE.test(line.trim()));
  if (firstHeading) {
    const cleaned = firstHeading.replace(/^#+\s*/, '').trim();
    if (cleaned) return cleaned;
  }
  return humanize(id);
}
