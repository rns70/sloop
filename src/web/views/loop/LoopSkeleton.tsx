// Loading screen for a single Loop page. Mirrors the prose layout — heading + status,
// the property rows, the plan block, and the agent-output panel — so the column keeps
// its shape until the cascade detail resolves.

import { Skeleton } from '../../design/index';

/** Label / value metadata row placeholder, matching PropertyRow's two-column rhythm. */
function PropRowSkeleton({ valueWidth }: { valueWidth: string }) {
  return (
    <div className="flex items-baseline gap-3 py-1.5">
      <Skeleton className="h-3 w-16 shrink-0" />
      <Skeleton className={`h-3.5 ${valueWidth}`} />
    </div>
  );
}

export function LoopSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading loop…</span>

      {/* Heading + status dot */}
      <div className="flex items-center gap-2.5">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-2 w-2" rounded="full" />
      </div>

      {/* Property rows */}
      <div className="mt-5" aria-hidden>
        <PropRowSkeleton valueWidth="w-20" />
        <PropRowSkeleton valueWidth="w-16" />
        <PropRowSkeleton valueWidth="w-44" />
      </div>

      {/* Plan section */}
      <div className="mt-6 border-t border-line-hair pt-4" aria-hidden>
        <Skeleton className="mb-3 h-4 w-12" />
        <div className="space-y-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      </div>

      {/* Agent output panel */}
      <div className="mt-6" aria-hidden>
        <Skeleton className="mb-2 h-2.5 w-24" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}
