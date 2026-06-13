// "Apply workflow" affordance for an ADR: a small disclosure menu that lists the
// configured workflows and, on pick, stamps the workflow's starter child-ADR tree onto
// this ADR (server-side, idempotent). On success it calls `onApplied` so the editor +
// run tree can refresh and show the new children.
//
// Accessibility: a real <button> with aria-haspopup/aria-expanded controls a
// role="menu" of role="menuitem" buttons; Escape and outside-click dismiss, mirroring
// the sidebar ContextMenu's dismiss model but scoped to this inline trigger.

import { useEffect, useRef, useState } from 'react';
import { applyWorkflow, getWorkflows, type WorkflowDef } from '../../api-client/index';
import { Button, cx } from '../../design/index';

export interface ApplyWorkflowButtonProps {
  /** The ADR to stamp the workflow onto (loops-prefixed relPath). */
  relPath: string;
  /** Called after a successful apply so the caller can refresh the ADR + its run tree. */
  onApplied: () => void;
  /** Disable the trigger (e.g. while a run is live). */
  disabled?: boolean;
}

export function ApplyWorkflowButton({ relPath, onApplied, disabled }: ApplyWorkflowButtonProps) {
  const [open, setOpen] = useState(false);
  const [workflows, setWorkflows] = useState<WorkflowDef[] | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Load the workflow list once the menu first opens (cheap; avoids a fetch on every ADR).
  useEffect(() => {
    if (!open || workflows) return;
    let cancelled = false;
    getWorkflows()
      .then((ws) => !cancelled && setWorkflows(ws))
      .catch(() => !cancelled && setWorkflows([]));
    return () => {
      cancelled = true;
    };
  }, [open, workflows]);

  // Dismiss on outside pointer / Escape while open.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function pick(workflowId: string): Promise<void> {
    setApplying(true);
    setError(null);
    try {
      await applyWorkflow(relPath, workflowId);
      setOpen(false);
      onApplied();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="subtle"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || applying}
        loading={applying}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Apply workflow
      </Button>

      {open && (
        <div
          role="menu"
          aria-label="Apply a workflow"
          className="absolute right-0 z-50 mt-1 min-w-[200px] overflow-hidden rounded-lg border border-line bg-paper py-1 shadow-lg"
        >
          {!workflows && (
            <p className="px-3 py-1.5 text-[12.5px] text-ink-faint">Loading…</p>
          )}
          {workflows && workflows.length === 0 && (
            <p className="px-3 py-1.5 text-[12.5px] text-ink-faint">No workflows defined.</p>
          )}
          {workflows?.map((w) => (
            <button
              key={w.id}
              type="button"
              role="menuitem"
              onClick={() => void pick(w.id)}
              disabled={applying}
              className={cx(
                'block w-full px-3 py-1.5 text-left text-[13px] text-ink transition-colors hover:bg-line-soft',
                'disabled:cursor-not-allowed disabled:opacity-50',
              )}
            >
              <span className="font-medium">{w.name || w.id}</span>
              <span className="ml-1.5 text-[11.5px] text-ink-faint">
                {w.steps.length} step{w.steps.length === 1 ? '' : 's'}
              </span>
            </button>
          ))}
          {error && (
            <p role="alert" className="mt-1 border-t border-line-soft px-3 py-1.5 text-[12px] text-status-failed">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
