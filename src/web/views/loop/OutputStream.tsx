// Streamed agent output for a single loop, rendered as a quiet mono panel. Shared by
// the Loop page and the inline expansion in the Mission Control tree.

import { useEffect, useRef } from 'react';
import { cx } from '../../design/index';

/** Light, calm syntax tint matching the mockups (✓ green, prompts muted). */
function lineClass(line: string): string {
  if (/✓|→\s*passed|exit 0/i.test(line)) return 'text-status-done';
  if (/✗|failed|exit [1-9]/i.test(line)) return 'text-status-failed';
  if (/running…|verify/i.test(line)) return 'text-accent';
  if (line.startsWith('$') || line.startsWith('pi ') || line.startsWith('[')) return 'text-ink-faint';
  return 'text-ink-muted';
}

export function OutputStream({ text, emptyHint }: { text: string; emptyHint?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  const lines = text.replace(/\n+$/, '').split('\n');
  const empty = text.trim().length === 0;

  return (
    <div
      ref={ref}
      className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md bg-line-soft px-3.5 py-2.5 font-mono text-[11.5px] leading-relaxed"
    >
      {empty ? (
        <span className="text-ink-subtle">{emptyHint ?? 'Waiting for agent output…'}</span>
      ) : (
        lines.map((line, i) => (
          <div key={i} className={cx(lineClass(line))}>
            {line || ' '}
          </div>
        ))
      )}
    </div>
  );
}
