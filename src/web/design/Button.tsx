import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

type Variant = 'primary' | 'subtle' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  children: ReactNode;
}

const VARIANT: Record<Variant, string> = {
  // Solid dark — the one strong affordance (e.g. Save), matching the mockup.
  primary: 'bg-ink text-white hover:bg-ink/90',
  // Quiet filled chip.
  subtle: 'bg-active text-ink/80 hover:bg-line',
  // Borderless text button.
  ghost: 'text-ink-muted hover:bg-line-soft',
};

/** Notion-quiet button. Small, rounded, restrained — primary is the only loud one. */
export function Button({ variant = 'subtle', className, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] font-medium leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
