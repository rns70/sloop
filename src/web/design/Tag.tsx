import type { ReactNode } from 'react';
import { cx } from './cx';
import { TONE_CLASS, type Tone } from './tokens';

export interface TagProps {
  /** Pastel tone; defaults to neutral gray. */
  tone?: Tone;
  children: ReactNode;
  className?: string;
}

/**
 * A small soft-pastel pill — the one persistent colored element in the UI
 * (used for role tags). Quiet, rounded, uppercase-free.
 */
export function Tag({ tone = 'gray', children, className }: TagProps) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded px-2 py-0.5 text-[11.5px] font-medium leading-none',
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
