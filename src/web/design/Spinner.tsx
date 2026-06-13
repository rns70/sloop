import { cx } from './cx';

type SpinnerSize = 'sm' | 'md' | 'lg';

/** Diameter per size, matched to the button/heading scale it sits in. */
const SIZE_CLASS: Record<SpinnerSize, string> = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-6 w-6',
};

export interface SpinnerProps {
  size?: SpinnerSize;
  /** Accessible label announced to screen readers (defaults to "Loading"). */
  label?: string;
  className?: string;
}

/**
 * Notion-quiet activity spinner: a thin ring with one accent arc. Uses `currentColor` so
 * it inherits the surrounding text color (white inside a primary button, accent
 * elsewhere). Under reduced-motion the ring stops spinning and pulses instead, so it
 * still reads as "busy" without rotation.
 */
export function Spinner({ size = 'md', label = 'Loading', className }: SpinnerProps) {
  return (
    <span role="status" aria-label={label} className={cx('inline-flex', className)}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
        className={cx(SIZE_CLASS[size], 'motion-safe:animate-spin motion-reduce:animate-pulse')}
      >
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
        <path
          d="M12 3a9 9 0 0 1 9 9"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
