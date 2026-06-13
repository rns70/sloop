import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import { Spinner } from './Spinner';

type Variant = 'primary' | 'subtle' | 'ghost';
type Size = 'sm' | 'md';

const VARIANT: Record<Variant, string> = {
  // Solid dark — the one strong affordance (e.g. Save), matching the mockup.
  primary: 'bg-ink text-white hover:bg-ink/90',
  // Quiet filled chip.
  subtle: 'bg-active text-ink/80 hover:bg-line',
  // Borderless text button.
  ghost: 'text-ink-muted hover:bg-line-soft',
};

/** Size scale. `min-h` is the hit-area floor: 24px clears WCAG 2.5.8 (AA) while
 *  staying dense enough for the Notion-quiet language. `md` is the default. */
const SIZE: Record<Size, string> = {
  sm: 'min-h-6 gap-1 px-2 text-[12px]',
  md: 'min-h-7 gap-1.5 px-2.5 text-[12.5px]',
};

/** Square hit-area for icon-only buttons, mirroring SIZE's min-h floors. */
const ICON_SIZE: Record<Size, string> = {
  sm: 'h-6 w-6',
  md: 'h-7 w-7',
};

const BASE =
  'inline-flex items-center justify-center rounded-md font-medium leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-50';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Show a leading spinner and block clicks while an async action is in flight. The
   *  label stays visible so the button keeps its width and the affordance stays legible. */
  loading?: boolean;
  children: ReactNode;
}

/** Notion-quiet button. Small, rounded, restrained — primary is the only loud one. */
export function Button({
  variant = 'subtle',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(BASE, SIZE[size], VARIANT[variant], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Spinner size="sm" className="-ml-0.5" />}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Required: icon-only buttons have no visible text label. */
  'aria-label': string;
  children: ReactNode;
}

/** Icon-only button with an enforced square hit-area so single-glyph controls
 *  (close, disclosure, remove) stay tappable instead of shrinking to the glyph. */
export function IconButton({
  variant = 'ghost',
  size = 'sm',
  className,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={cx(BASE, ICON_SIZE[size], 'shrink-0', VARIANT[variant], className)}
      {...rest}
    >
      {children}
    </button>
  );
}
