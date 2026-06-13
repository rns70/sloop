import { simpleGit } from 'simple-git';

/**
 * Paths sloop owns and that an agent leaf is never credited with "writing": the
 * desired-state databank, the cascade bookkeeping, and sloop config. Everything
 * else (notably `code/`) is fair game and subject to the output sandbox.
 */
export const SLOOP_OWN_PREFIXES = ['databank/', 'cascades/', '.sloop/'] as const;

function isOwn(p: string): boolean {
  return SLOOP_OWN_PREFIXES.some((prefix) => p.startsWith(prefix));
}

/** Pure: paths in `after` not in `before`, excluding sloop's own bookkeeping paths. */
export function diffPathSets(before: Set<string>, after: Set<string>): string[] {
  const out: string[] = [];
  for (const p of after) {
    if (!before.has(p) && !isOwn(p)) out.push(p);
  }
  return out.sort();
}

/** Working-tree dirty set via `git status --porcelain` (repo-root-relative paths). */
export async function gitDirtySet(cwd: string): Promise<Set<string>> {
  const git = simpleGit({ baseDir: cwd });
  const status = await git.status();
  return new Set(status.files.map((f) => f.path));
}
