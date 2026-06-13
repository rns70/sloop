import type { ReactNode } from 'react';
import { cx } from './cx';

export interface PageProps {
  /** Quiet breadcrumb shown at the left of the top bar (e.g. `Databank / adr-007.md`). */
  breadcrumb?: ReactNode;
  /** Minor right-aligned context (toggles, Save, etc.). */
  actions?: ReactNode;
  /** When true the body is a constrained prose column (editor); otherwise full width (lists). */
  prose?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * The routed content area. A single quiet top bar — a breadcrumb on the left and
 * minor context on the right (NO top tabs; navigation is the sidebar). Below it,
 * the scrollable body.
 */
export function Page({ breadcrumb, actions, prose = false, children, className }: PageProps) {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-paper">
      <div className="flex h-11 shrink-0 items-center gap-3 border-b border-line-hair px-5 text-[12.5px]">
        <div className="min-w-0 truncate text-ink-muted">{breadcrumb}</div>
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cx(prose ? 'mx-auto max-w-prose px-8 py-7' : 'px-8 py-7', className)}>
          {children}
        </div>
      </div>
    </div>
  );
}
