import type { ReactNode } from 'react';
import { MISSING_CRITERIA_WARNING } from '../../shared/index';
import { cx } from './cx';

interface CriteriaWarningProps {
  /** 'banner' = full-width notice; 'badge' = compact inline indicator. */
  variant?: 'banner' | 'badge';
  /** Optional trailing slot, e.g. the "Add with assistant" button or a source-ADR link. */
  action?: ReactNode;
  className?: string;
}

/**
 * Non-blocking amber notice shown when a design/loop has no acceptance criteria.
 * Amber (not status red) signals caution rather than error. The message is the
 * shared single source of truth (`MISSING_CRITERIA_WARNING`).
 */
export function CriteriaWarning({ variant = 'banner', action, className }: CriteriaWarningProps) {
  if (variant === 'badge') {
    return (
      <span
        role="status"
        title={MISSING_CRITERIA_WARNING}
        className={cx(
          'inline-flex items-center gap-1 rounded bg-role-amberBg px-1.5 py-0.5 text-[11px] font-medium text-role-amber',
          className,
        )}
      >
        <span aria-hidden>⚠</span> No acceptance criteria
      </span>
    );
  }
  return (
    <div
      role="status"
      className={cx(
        'mb-4 flex items-start gap-2 rounded-md bg-role-amberBg px-3 py-2 text-[12.5px] text-role-amber',
        className,
      )}
    >
      <span aria-hidden className="mt-px">⚠</span>
      <span className="flex-1">{MISSING_CRITERIA_WARNING}</span>
      {action && <span className="shrink-0">{action}</span>}
    </div>
  );
}
