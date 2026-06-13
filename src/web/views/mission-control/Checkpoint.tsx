// The human gate (spec §5.4). While the root loop is `awaiting_approval`, the proposed
// tree is rendered below this banner for review; inner/leaf loops do not run until the
// operator clicks "Approve & run". This is purely the gate — the loop tree is the single
// source of truth for *what* was proposed, so we don't re-list the loops here.

import { Button } from '../../design/index';

export interface CheckpointProps {
  proposedCount: number;
  onApprove: () => void;
  approving: boolean;
  error?: string | null;
}

export function Checkpoint({ proposedCount, onApprove, approving, error }: CheckpointProps) {
  return (
    <div className="mb-6 flex items-start gap-3.5 rounded-lg border border-line bg-sidebar p-4">
      <span className="mt-[5px] text-[10px] leading-none text-status-running">●</span>

      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold leading-tight">
          Checkpoint: approve the proposed tree
        </div>
        <div className="mt-1.5 text-[12.5px] text-ink-faint">
          The architect proposed {proposedCount} loop{proposedCount === 1 ? '' : 's'}. Review the
          tree below, then approve. Nothing runs until you do.
        </div>
        {error && <div className="mt-2 text-[12px] text-status-failed">{error}</div>}
      </div>

      <Button variant="primary" onClick={onApprove} loading={approving} className="shrink-0">
        {approving ? 'Starting run…' : 'Approve & run'}
      </Button>
    </div>
  );
}
