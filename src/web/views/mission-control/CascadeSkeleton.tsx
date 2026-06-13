// Loading screen for Mission Control. Mirrors the real cascade layout — title + status,
// the meta line, and a short stack of loop-tree rows — so the page keeps its shape and
// doesn't jump when the cascade detail arrives.

import { Label, Skeleton } from '../../design/index';

/** Loop-tree row placeholder: caret · title · role pill · model · status, matching LoopNode. */
function RowSkeleton({ titleWidth }: { titleWidth: string }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-line-soft px-1 py-2">
      <Skeleton className="h-4 w-4" rounded="sm" />
      <Skeleton className={`h-3.5 ${titleWidth}`} />
      <Skeleton className="h-4 w-14" rounded="full" />
      <Skeleton className="h-3 w-16" />
      <span className="ml-auto">
        <Skeleton className="h-3 w-14" />
      </span>
    </div>
  );
}

// Hand-varied widths so the placeholder reads as a real tree, not a barcode.
const ROW_WIDTHS = ['w-56', 'w-40', 'w-48', 'w-36'];

export function CascadeSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading cascade…</span>

      {/* Title + status dot */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-6 w-52" />
        <Skeleton className="h-2 w-2" rounded="full" />
      </div>

      {/* Meta line: databank delta · progress */}
      <div className="mb-6 mt-2.5 flex items-center gap-3">
        <Skeleton className="h-3 w-28" />
        <span className="text-ink-subtle">|</span>
        <Skeleton className="h-3 w-24" />
      </div>

      <Label className="mb-1 px-1">Loop tree</Label>
      <div className="border-t border-line-soft" aria-hidden>
        {ROW_WIDTHS.map((w, i) => (
          <RowSkeleton key={i} titleWidth={w} />
        ))}
      </div>
    </div>
  );
}
