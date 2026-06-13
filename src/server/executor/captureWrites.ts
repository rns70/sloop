import { simpleGit } from 'simple-git';

/**
 * Paths sloop owns and that an agent leaf is never credited with "writing": the
 * desired-state loops, the cascade bookkeeping, and sloop config. Everything
 * else (notably `code/`) is fair game and subject to the output sandbox.
 */
export const SLOOP_OWN_PREFIXES = ['loops/', 'cascades/', '.sloop/'] as const;

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

/**
 * Working-tree dirty set via `git status --porcelain --untracked-files=all`.
 *
 * INVARIANT: `cwd` MUST be the git repo root (which is sloop's workspace root).
 * Returned paths are repo-root-relative — exactly the form the `code/` and
 * {@link SLOOP_OWN_PREFIXES} prefix matching in {@link diffPathSets} depends on.
 * Passing a subdirectory would yield paths relative to a different base and
 * silently break that prefix matching (and thus the output-glob sandbox).
 *
 * `--untracked-files=all` forces git to expand an entirely-untracked directory
 * into its individual file paths. The default `git status --porcelain` collapses
 * such a directory into a single trailing-slash entry (e.g. `code/newmod/`),
 * which would under-capture the agent's writes and feed a directory path — rather
 * than the real files — into the sandbox check.
 */
export async function gitDirtySet(cwd: string): Promise<Set<string>> {
  const git = simpleGit({ baseDir: cwd });
  const status = await git.status(['--untracked-files=all']);
  return new Set(status.files.map((f) => f.path));
}
