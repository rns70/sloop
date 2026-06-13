// Pure text helpers for rendering loop/cascade identifiers as human labels.
// Co-located with the cascade module the loop/library views already depend on.

/** `rotate-refresh-tokens` → `rotate refresh tokens`; strips a leading underscore. */
export function humanize(id: string): string {
  return id.replace(/^_/, '').replace(/[-_]+/g, ' ').trim();
}

/** Cascade ids are date-prefixed (`2026-06-13-token-rotation-sync`); drop the date. */
export function humanizeCascade(id: string): string {
  return humanize(id.replace(/^\d{4}-\d{2}-\d{2}-/, ''));
}

const HEADING_PREFIX = /^#+\s*(?:Leaf|Inner loop|Architecture loop)\s*[—–-]\s*/i;

/** A loop's display title: first markdown heading (sans boilerplate prefix), else humanized id. */
export function loopTitle(id: string, body: string, cascadeId?: string): string {
  if (id === '_architect' || id.endsWith('/_architect')) {
    return cascadeId ? `Decompose ${humanizeCascade(cascadeId)}` : 'Decompose';
  }
  const firstHeading = body.split('\n').find((line) => /^#+\s/.test(line));
  if (firstHeading) {
    const cleaned = firstHeading.replace(HEADING_PREFIX, '').replace(/^#+\s*/, '').trim();
    if (cleaned) return humanize(cleaned);
  }
  return humanize(id);
}
