// Mission Control for one cascade: the live loop tree, the approval checkpoint, and
// the convergence "money shot" when the root flips to done.

import { useState } from 'react';
import { Button, Label, Page, StatusDot } from '../../design/index';
import type { LoopStatus } from '../../api-client/index';
import { useCascade } from './CascadeContext';
import { Checkpoint } from './Checkpoint';
import { LoopTree } from './LoopTree';
import { humanizeCascade } from './text';
import { useRoleLabel } from './useRoleLabel';

function deltaSummary(deltas: { add: number; change: number; delete: number }): string {
  const parts: string[] = [];
  if (deltas.add) parts.push(`${deltas.add} added`);
  if (deltas.change) parts.push(`${deltas.change} changed`);
  if (deltas.delete) parts.push(`${deltas.delete} deleted`);
  return parts.join('  ·  ');
}

export function CascadeView() {
  const { id, detail, error, approved, rootStatus, loops, outputs, approve } = useCascade();
  const roleLabel = useRoleLabel();
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  const name = humanizeCascade(id);

  const handleApprove = () => {
    setApproving(true);
    setApproveError(null);
    approve()
      .catch((e: unknown) => setApproveError(e instanceof Error ? e.message : String(e)))
      .finally(() => setApproving(false));
  };

  if (error) {
    return (
      <Page breadcrumb={`Cascades / ${name}`}>
        <p className="text-[13px] text-status-failed">Failed to load cascade: {error}</p>
      </Page>
    );
  }
  if (!detail) {
    return (
      <Page breadcrumb={`Cascades / ${name}`}>
        <p className="text-[13px] text-ink-faint">Loading cascade…</p>
      </Page>
    );
  }

  const { summary } = detail;
  const isDone = rootStatus === 'done';
  const showCheckpoint = !approved && rootStatus === 'awaiting_approval';
  const displayStatus: LoopStatus = isDone
    ? 'done'
    : approved
      ? 'executing'
      : rootStatus ?? summary.status;

  const total = loops.length;
  const doneCount = loops.filter((l) => l.frontmatter.status === 'done').length;
  const allCriteria = loops.flatMap((l) => l.frontmatter.acceptanceCriteria ?? []);
  const passedCriteria = allCriteria.filter((cr) => cr.passed).length;
  const deltas = deltaSummary(summary.deltas);

  return (
    <Page
      breadcrumb={`Cascades / ${name}`}
      actions={
        <span className="font-mono text-[11px] text-ink-subtle">
          {summary.workflow} · cascade/{name}
        </span>
      }
    >
      {isDone && (
        <SuccessBanner
          name={name}
          total={total}
          passedCriteria={passedCriteria}
          totalCriteria={allCriteria.length}
        />
      )}

      <div className="flex items-baseline gap-3">
        <h1 className="text-[22px] font-bold tracking-[-0.01em]">{name}</h1>
        <StatusDot status={displayStatus} />
      </div>
      <div className="mb-5 mt-1 text-[13px] text-ink-faint">
        {deltas && (
          <>
            {deltas}
            <span className="mx-3 text-ink-subtle">|</span>
          </>
        )}
        {doneCount} of {total} loops done
      </div>

      {showCheckpoint && (
        <Checkpoint
          loops={loops}
          roleLabel={roleLabel}
          onApprove={handleApprove}
          approving={approving}
          error={approveError}
        />
      )}

      <Label className="mb-1 px-1">Loop tree</Label>
      <div className="border-t border-line-soft">
        <LoopTree
          loops={loops}
          rootLoopId={summary.rootLoopId}
          cascadeId={id}
          roleLabel={roleLabel}
          outputs={outputs}
        />
      </div>
    </Page>
  );
}

function SuccessBanner({
  name,
  total,
  passedCriteria,
  totalCriteria,
}: {
  name: string;
  total: number;
  passedCriteria: number;
  totalCriteria: number;
}) {
  return (
    <div className="mb-6 flex items-center gap-3.5 rounded-lg border border-diff-addAccent/40 bg-diff-addBg px-4 py-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-diff-addBg text-[17px] text-status-done ring-1 ring-diff-addAccent/40">
        ✓
      </div>
      <div>
        <div className="text-[16px] font-bold text-diff-addText">Codebase matches the databank</div>
        <div className="mt-0.5 text-[12.5px] text-diff-addText/80">
          {name} converged · {total} loops · {passedCriteria}/{totalCriteria} criteria passed
        </div>
      </div>
      <div className="ml-auto flex gap-2">
        <Button variant="subtle" title="Wired in WP-6 (integration)">
          View diff
        </Button>
        <Button variant="primary" title="Wired in WP-6 (integration)">
          Merge to main
        </Button>
      </div>
    </div>
  );
}
