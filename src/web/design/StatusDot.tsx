import type { LoopStatus } from '../../shared/index';
import { cx } from './cx';
import { statusMeta } from './tokens';

export interface StatusDotProps {
  status: LoopStatus;
  /** Hide the text label, show only the dot. */
  dotOnly?: boolean;
  className?: string;
}

/**
 * A small status label with a single leading dot (running=blue, done=green,
 * blocked/failed=red, queued/planned=faint gray). The dot is the only color.
 */
export function StatusDot({ status, dotOnly = false, className }: StatusDotProps) {
  const { label, dotClass } = statusMeta(status);
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-[12px] text-ink-muted', className)}>
      <span className={cx('text-[8px] leading-none', dotClass)} aria-hidden>
        ●
      </span>
      {!dotOnly && <span>{label}</span>}
    </span>
  );
}
