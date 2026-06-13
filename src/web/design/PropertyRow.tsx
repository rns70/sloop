import type { ReactNode } from 'react';
import { cx } from './cx';

export interface PropertyRowProps {
  /** Left-hand property name (quiet, fixed-width). */
  label: ReactNode;
  /** Right-hand value. */
  children: ReactNode;
  className?: string;
}

/**
 * A Notion-style property row: a muted fixed-width label on the left, the value
 * on the right. Stacks of these read as a quiet metadata table without borders.
 */
export function PropertyRow({ label, children, className }: PropertyRowProps) {
  return (
    <div className={cx('flex items-baseline gap-3 py-1 text-[13.5px]', className)}>
      <div className="w-32 shrink-0 text-ink-faint">{label}</div>
      <div className="min-w-0 flex-1 text-ink">{children}</div>
    </div>
  );
}
