import type { ReactNode } from 'react';
import { cx } from './cx';

export interface CardProps {
  children: ReactNode;
  className?: string;
}

/**
 * A very light container. Notion-quiet: a soft hairline border + subtle rounding,
 * never a heavy drop-shadowed card. Use sparingly — most groupings are just
 * hairline-divided rows, not boxes.
 */
export function Card({ children, className }: CardProps) {
  return (
    <div className={cx('rounded-lg border border-line bg-paper', className)}>{children}</div>
  );
}
