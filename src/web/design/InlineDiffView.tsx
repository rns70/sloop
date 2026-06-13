import { useMemo } from 'react';
import { cx } from './cx';
import { diffLines, hasChanges, type DiffLine } from './diff';

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

const OP_CLASS: Record<DiffLine['op'], string> = {
  add: 'bg-diff-addBg text-diff-addText rounded shadow-[inset_2px_0_0_#5aa978]',
  del: 'bg-diff-delBg text-diff-delText rounded line-through opacity-75',
  same: '',
};

/**
 * Renders a before/after markdown diff *inline within the document flow* — added
 * lines get a green left accent, removed lines a red strikethrough. Read-only.
 * This is the in-document diff treatment (not a side rail), per the locked design.
 */
export function InlineDiffView({ before, after, className }: InlineDiffViewProps) {
  const lines = useMemo(() => diffLines(before, after), [before, after]);
  const changed = hasChanges(before, after);

  return (
    <div className={cx('text-[14.5px] leading-[1.75] text-ink', className)}>
      {!changed && (
        <p className="mb-4 text-[12.5px] text-ink-faint">
          No pending changes — this matches the last accepted version.
        </p>
      )}
      {lines.map((line, idx) => {
        const blank = line.text.trim() === '';
        if (blank && line.op === 'same') return <div key={idx} className="h-3" />;
        return (
          <div key={idx} className="my-0.5">
            <span className={cx('inline px-1 py-0.5', lineClass(line.text), OP_CLASS[line.op])}>
              {lineText(line.text) || ' '}
            </span>
          </div>
        );
      })}
    </div>
  );
}
