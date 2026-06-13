/**
 * Output-glob sandbox. Given the files an agent wrote and the leaf's `allowedOutputs`
 * globs, return the files OUTSIDE the allow-list (the violations).
 *
 * Empty/undefined allow-list = unrestricted (legacy leaves keep running).
 *
 * Glob grammar (POSIX-path, '/'-separated): `**` matches any number of segments
 * (including zero); `*` matches within a single segment; all other characters are
 * literal. This is intentionally minimal — sandbox globs are simple path scopes
 * (`code/**`, `code/*.ts`), not a general fnmatch.
 */
export function validateOutputs(writtenFiles: string[], allowedOutputs: string[] | undefined): string[] {
  if (!allowedOutputs || allowedOutputs.length === 0) return [];
  const matchers = allowedOutputs.map(globToRegExp);
  return writtenFiles.filter((file) => !matchers.some((re) => re.test(file)));
}

/** Compile a minimal glob to an anchored RegExp. */
function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // `**` — any number of path segments (and the optional trailing slash).
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++; // consume the slash after ** so `a/**/b` works
      } else {
        re += '[^/]*'; // `*` — within one segment
      }
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&'); // escape regex metachars
    }
  }
  return new RegExp(`^${re}$`);
}
