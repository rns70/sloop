// The human gate (spec §5.4). While the root loop is `awaiting_approval`, the proposed
// tree is shown for approval; inner/leaf loops do not run until "Approve & run".

import type { LoopDoc } from '../../api-client/index';
import { Button, Tag, roleTone } from '../../design/index';
import { loopTitle } from './text';

export interface CheckpointProps {
  loops: LoopDoc[];
  roleLabel: (roleId: string) => string;
  onApprove: () => void;
  approving: boolean;
  error?: string | null;
}

export function Checkpoint({ loops, roleLabel, onApprove, approving, error }: CheckpointProps) {
  // Everything the architect proposed to run (i.e. not the architect itself).
  const proposed = loops.filter((l) => l.frontmatter.kind !== 'architect');

  return (
    <div className="mb-6 rounded-lg border border-line bg-sidebar p-4">
      <div className="mb-1 flex items-center gap-2.5">
        <span className="text-[10px] leading-none text-status-running">●</span>
        <span className="text-[15px] font-semibold">Checkpoint — approve the proposed tree</span>
      </div>
      <div className="mb-3.5 text-[12.5px] text-ink-faint">
        The architect proposed {proposed.length} loop{proposed.length === 1 ? '' : 's'}. Nothing
        runs until you approve.
      </div>

      <div className="mb-3.5">
        {proposed.map((l) => (
          <div
            key={l.frontmatter.id}
            className="flex items-center gap-2.5 border-t border-line-soft py-1.5"
          >
            <span className="text-[12px] text-ink-subtle">↳</span>
            <span className="text-[13.5px]">{loopTitle(l.frontmatter.id, l.body)}</span>
            <Tag tone={roleTone(l.frontmatter.role)}>{roleLabel(l.frontmatter.role)}</Tag>
            <span className="text-[11.5px] text-ink-faint">
              {l.frontmatter.delta
                ? `${l.frontmatter.model} · ${l.frontmatter.delta}`
                : l.frontmatter.model}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={onApprove} disabled={approving}>
          {approving ? 'Approving…' : 'Approve & run'}
        </Button>
        {error && <span className="text-[12px] text-status-failed">{error}</span>}
      </div>
    </div>
  );
}
