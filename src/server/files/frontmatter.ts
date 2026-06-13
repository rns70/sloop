import matter from 'gray-matter';

/**
 * Thin, typed wrappers over `gray-matter` so the rest of the server treats a
 * markdown-with-frontmatter file as a `{ data, body }` pair. The round trip
 * (parse -> serialize -> parse) is stable: serializing then re-parsing yields the
 * same `data`/`body`, which is what every loop/ADR read-modify-write relies on.
 */
export interface ParsedDoc<T = Record<string, unknown>> {
  data: T;
  body: string;
}

/** Parse a markdown string into its frontmatter `data` and markdown `body`. */
export function parseFrontmatter<T = Record<string, unknown>>(raw: string): ParsedDoc<T> {
  const parsed = matter(raw);
  return { data: parsed.data as T, body: parsed.content };
}

/**
 * Serialize frontmatter `data` + markdown `body` back to a `---`-fenced document.
 *
 * `undefined` values are pruned first: optional fields on the shared types (e.g.
 * `LoopFrontmatter.parent`, `AcceptanceCriterion.verify`) are commonly absent, and
 * js-yaml (under gray-matter) would otherwise emit them as `null` and break the
 * round trip. Pruning keeps absent-stays-absent.
 */
export function serializeFrontmatter(data: Record<string, unknown>, body: string): string {
  return matter.stringify(body, pruneUndefined(data) as Record<string, unknown>);
}

/** Recursively drop keys whose value is `undefined` (arrays and nested objects too). */
function pruneUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => pruneUndefined(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[key] = pruneUndefined(v);
    }
    return out as T;
  }
  return value;
}
