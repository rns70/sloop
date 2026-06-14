import { useMemo } from 'react';
import { cx } from './cx';
import { diffRows, diffStats, type DiffOp, type Row } from './diff';

export interface InlineDiffViewProps {
  before: string;
  after: string;
  className?: string;
}

/** Light per-line markdown shaping so the diff reads as a document, not a code block. */
function lineClass(text: string): string {
  const t = text.trimStart();
  if (t.startsWith('# ')) return 'text-[22px] font-bold tracking-[-0.01em]';
  if (t.startsWith('## ')) return 'text-[15px] font-semibold';
  if (t.startsWith('### ')) return 'text-[14px] font-semibold';
  if (t.startsWith('> ')) return 'border-l-2 border-line pl-3 text-ink-muted';
  return '';
}

/** Strip the leading markdown markers we visually express via lineClass. */
function lineText(text: string): string {
  return text.replace(/^\s*(#{1,3}\s|>\s)/, '');
}

const ROW_BAND: Record<Row['kind'], string> = {
  same: '',
  add: 'bg-diff-addBg',
  del: 'bg-diff-delBg',
  mod: 'bg-diff-changeBg',
};

const GUTTER: Record<Row['kind'], string> = { same: ' ', add: '+', del: '−', mod: '~' };

const GUTTER_CLASS: Record<Row['kind'], string> = {
  same: 'text-transparent',
  add: 'text-diff-addAccent',
  del: 'text-diff-delText',
  mod: 'text-diff-changeAccent',
};

/** Word-segment tint inside a `mod` row. */
const SEG_CLASS: Record<DiffOp, string> = {
  same: '',
  add: 'rounded-sm bg-diff-addBg text-diff-addText',
  del: 'rounded-sm bg-diff-delBg text-diff-delText line-through opacity-80',
};

/**
 * Renders a before/after markdown diff *inline within the document flow*. Each line is a
 * row with a gutter marker (+ / − / ~) and a soft tint band; a `mod` row highlights only
 * the words that changed (added green, removed red-strikethrough) rather than nuking the
 * whole line. Read-only. This is the in-document diff treatment (not a side rail), per the
 * locked design.
 */
export function InlineDiffView({ before, after, className }: InlineDiffViewProps) {
  const rows = useMemo(() => diffRows(before, after), [before, after]);
  const stats = useMemo(() => diffStats(before, after), [before, after]);
  const changed = stats.added > 0 || stats.removed > 0;

  return (
    <div className={cx('text-[14.5px] leading-[1.75] text-ink', className)}>
      {!changed && (
        <p className="mb-4 text-[12.5px] text-ink-faint">
          No pending changes — this matches the last accepted version.
        </p>
      )}
      {rows.map((row, idx) => {
        const blank = row.text.trim() === '';
        if (blank && row.kind === 'same') return <div key={idx} className="h-3" />;
        return (
          <div key={idx} className={cx('-mx-2 my-0.5 flex gap-2 rounded px-2', ROW_BAND[row.kind])}>
            <span
              aria-hidden
              className={cx('select-none font-mono text-[12px] leading-[1.75]', GUTTER_CLASS[row.kind])}
            >
              {GUTTER[row.kind]}
            </span>
            <span className={cx('min-w-0 flex-1', row.kind !== 'mod' && lineClass(row.text))}>
              {row.kind === 'mod'
                ? row.segs.map((seg, s) => (
                    <span key={s} className={cx(SEG_CLASS[seg.op])}>
                      {seg.text}
                    </span>
                  ))
                : lineText(row.text) || ' '}
            </span>
          </div>
        );
      })}
    </div>
  );
}
