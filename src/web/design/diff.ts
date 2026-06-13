// A small, dependency-free line-level diff. The hackathon spec calls for a
// simple block/line diff of two markdown strings — not a full word-level engine.
// Used by InlineDiffView (and MarkdownEditor's read-only diff mode) to show
// adds/removes inline within the document flow.

export type DiffOp = 'same' | 'add' | 'del';

export interface DiffLine {
  op: DiffOp;
  text: string;
}

/**
 * Longest-common-subsequence line diff. Returns an ordered list of lines tagged
 * `same` / `add` (present only in `after`) / `del` (present only in `before`).
 * Trailing whitespace is preserved; empty lines participate so blank-line changes
 * still register.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;

  // lcs[i][j] = length of LCS of a[i:] and b[j:].
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: 'same', text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ op: 'del', text: a[i] });
      i++;
    } else {
      out.push({ op: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ op: 'del', text: a[i++] });
  while (j < m) out.push({ op: 'add', text: b[j++] });
  return out;
}

/** True when the two strings differ (after trimming trailing newline noise). */
export function hasChanges(before: string, after: string): boolean {
  return before.replace(/\s+$/, '') !== after.replace(/\s+$/, '');
}
