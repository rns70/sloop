import { cx } from './cx';

export interface SkeletonProps {
  /** Sizing/spacing utilities for this placeholder (e.g. `h-4 w-40`). */
  className?: string;
  /** Corner radius token; `full` for avatars/dots, `md` for blocks (default). */
  rounded?: 'sm' | 'md' | 'full';
}

const RADIUS: Record<NonNullable<SkeletonProps['rounded']>, string> = {
  sm: 'rounded',
  md: 'rounded-md',
  full: 'rounded-full',
};

/**
 * A single placeholder block. A low-contrast light sweep crosses it while content loads;
 * under reduced-motion the sweep is suppressed and the block pulses instead. Purely
 * decorative — hidden from assistive tech (the loading screen owns the live region).
 *
 * Compose several to mirror the real layout's shape, so the page doesn't jump on load.
 */
export function Skeleton({ className, rounded = 'md' }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cx(
        'relative overflow-hidden bg-line motion-reduce:animate-pulse',
        RADIUS[rounded],
        className,
      )}
    >
      <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-paper/70 to-transparent motion-safe:animate-shimmer" />
    </div>
  );
}
