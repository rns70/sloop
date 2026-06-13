import type { ReactNode } from 'react';
import { cx } from './cx';

export interface LabelProps {
  children: ReactNode;
  className?: string;
}

/** Small uppercase section label — the quiet caps used in the sidebar and above lists. */
export function Label({ children, className }: LabelProps) {
  return (
    <div
      className={cx(
        'text-[10px] font-medium uppercase tracking-[0.07em] text-ink-subtle',
        className,
      )}
    >
      {children}
    </div>
  );
}
