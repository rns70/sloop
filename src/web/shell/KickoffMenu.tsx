import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createCascade, getWorkflows, type WorkflowDef } from '../api-client/index';
import { cx, Spinner } from '../design/index';

/**
 * The global "kick off cascade" affordance. Opens a workflow picker; choosing one
 * POSTs a new cascade and routes to its (WP-5) Mission Control view.
 */
export function KickoffMenu() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [workflows, setWorkflows] = useState<WorkflowDef[] | null>(null);
  // The workflow currently being kicked off (architect is planning); null when idle.
  const [kickingId, setKickingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = kickingId !== null;
  const rootRef = useRef<HTMLDivElement>(null);

  // Lazy-load workflows the first time the menu opens.
  useEffect(() => {
    if (!open || workflows) return;
    getWorkflows()
      .then(setWorkflows)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [open, workflows]);

  // Dismiss on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  async function kickoff(workflowId: string) {
    setKickingId(workflowId);
    setError(null);
    try {
      const summary = await createCascade({ workflowId });
      setOpen(false);
      navigate(`/cascades/${encodeURIComponent(summary.id)}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setKickingId(null);
    }
    // On success we navigate away (this menu unmounts), so kickingId is intentionally
    // left set to keep the spinner showing through the transition.
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium text-ink-muted transition-colors hover:bg-line-soft"
      >
        <span className="text-[15px] leading-none text-ink-faint">＋</span>
        Kick off cascade
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-line bg-paper py-1 shadow-lg">
          {error && <div className="px-3 py-2 text-[12px] text-status-failed">{error}</div>}
          {!workflows && !error && (
            <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-ink-faint">
              <Spinner size="sm" className="text-ink-faint" /> Loading workflows…
            </div>
          )}
          {workflows?.map((t) => {
            const kicking = kickingId === t.id;
            return (
              <button
                key={t.id}
                type="button"
                disabled={busy}
                onClick={() => void kickoff(t.id)}
                className={cx(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-ink transition-colors hover:bg-line-soft',
                  // Dim only the non-active items while one is planning; the active row
                  // stays full-strength with its spinner.
                  busy && !kicking && 'opacity-40',
                )}
              >
                {kicking && <Spinner size="sm" className="text-accent" />}
                <span className={cx(kicking && 'font-medium text-accent')}>{t.name}</span>
                <span className="ml-auto text-[11px] text-ink-faint">
                  {kicking ? 'Planning…' : `${t.steps.length} steps`}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
