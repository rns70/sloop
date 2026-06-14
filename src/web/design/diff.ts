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

/** One intra-line segment of a word-level diff. */
export interface Seg {
  op: DiffOp;
  text: string;
}

/**
 * A rendered diff row. `same`/`add`/`del` carry a whole line; `mod` is a paired
 * change whose `segs` are the word-level diff and whose `text` is the *after* line
 * (used for markdown shaping).
 */
export type Row =
  | { kind: 'same'; text: string }
  | { kind: 'add'; text: string }
  | { kind: 'del'; text: string }
  | { kind: 'mod'; segs: Seg[]; text: string };

/** Split a line into word + whitespace tokens (whitespace kept so a join is lossless). */
function tokenize(line: string): string[] {
  return line.split(/(\s+)/).filter((t) => t !== '');
}

/**
 * Word-level LCS diff of two lines. Returns ordered segments tagged
 * `same`/`add`/`del`; adjacent same-op segments are merged so a render walks fewer
 * spans. Concatenating non-`del` segment text reproduces `after`; non-`add` reproduces
 * `before`.
 */
export function wordDiff(before: string, after: string): Seg[] {
  const a = tokenize(before);
  const b = tokenize(after);
  const n = a.length;
  const m = b.length;

  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const raw: Seg[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push({ op: 'same', text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      raw.push({ op: 'del', text: a[i] });
      i++;
    } else {
      raw.push({ op: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) raw.push({ op: 'del', text: a[i++] });
  while (j < m) raw.push({ op: 'add', text: b[j++] });

  const merged: Seg[] = [];
  for (const seg of raw) {
    const last = merged[merged.length - 1];
    if (last && last.op === seg.op) last.text += seg.text;
    else merged.push({ ...seg });
  }
  return merged;
}

/**
 * Line diff post-processed into render rows: a maximal run of consecutive removed
 * lines is zipped against the immediately-following run of added lines into `mod`
 * rows (word-diffed); any leftover lines on either side become pure `del`/`add` rows.
 * Unchanged lines pass through as `same`. This turns a one-word edit from a
 * delete-whole-line + add-whole-line pair into a single word-highlighted row.
 */
export function diffRows(before: string, after: string): Row[] {
  const lines = diffLines(before, after);
  const rows: Row[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.op === 'same') {
      rows.push({ kind: 'same', text: line.text });
      i++;
      continue;
    }
    if (line.op === 'add') {
      rows.push({ kind: 'add', text: line.text });
      i++;
      continue;
    }
    // line.op === 'del': an empty deleted line is a trailing-newline artifact, not a
    // genuine edit — pass it through as context so it never pairs into a spurious mod.
    if (line.text === '') {
      rows.push({ kind: 'same', text: line.text });
      i++;
      continue;
    }
    // gather the del run, then the following add run, and zip them.
    const dels: string[] = [];
    while (i < lines.length && lines[i].op === 'del' && lines[i].text !== '') dels.push(lines[i++].text);
    const adds: string[] = [];
    while (i < lines.length && lines[i].op === 'add') adds.push(lines[i++].text);
    const pairs = Math.min(dels.length, adds.length);
    for (let k = 0; k < pairs; k++) {
      rows.push({ kind: 'mod', segs: wordDiff(dels[k], adds[k]), text: adds[k] });
    }
    for (let k = pairs; k < dels.length; k++) rows.push({ kind: 'del', text: dels[k] });
    for (let k = pairs; k < adds.length; k++) rows.push({ kind: 'add', text: adds[k] });
  }
  return rows;
}

/** Changed-line counts for the editor toggle badge. A `mod` row counts as both. */
export function diffStats(before: string, after: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const row of diffRows(before, after)) {
    if (row.kind === 'add') added++;
    else if (row.kind === 'del') removed++;
    else if (row.kind === 'mod') {
      added++;
      removed++;
    }
  }
  return { added, removed };
}
