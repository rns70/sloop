// The run-history drawer (dev-rens style): a toggleable right-side panel listing past
// ADR runs — root ADR, outcome, when, and the failure evidence for failed runs. Fed by
// GET /api/runs. Owns its own open/visibility state and renders both the trigger control
// and the slide-over panel, so the shell mounts it once.
//
// Pure derivation/formatting lives in historyDrawer.ts (unit-tested without a DOM); this
// component is the React shell around it.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getRuns, type RunHistoryEntry } from '../api-client/index';
import { cx, IconButton } from '../design/index';
import { adrRoute } from './commands';
import { relativeTime, runLabel, sortRunsNewestFirst } from './runHistory';

/** A small clock glyph for the trigger. */
function ClockIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.5V8l2.4 1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StatusBadge({ status }: { status: RunHistoryEntry['status'] }) {
  const passed = status === 'passed';
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-muted">
      <span
        className={cx('text-[8px] leading-none', passed ? 'text-status-done' : 'text-status-failed')}
        aria-hidden
      >
        ●
      </span>
      {passed ? 'passed' : 'failed'}
    </span>
  );
}

function RunRow({ entry, onOpen }: { entry: RunHistoryEntry; onOpen: () => void }) {
  const subtreeCount = entry.runSet.length;
  return (
    <li className="border-b border-line-soft px-4 py-3">
      <div className="flex items-baseline gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 truncate text-left font-mono text-[12.5px] text-ink hover:underline"
          title={runLabel(entry)}
        >
          {runLabel(entry)}
        </button>
        <span className="shrink-0 text-[11.5px] text-ink-faint">{relativeTime(entry.createdAt)}</span>
      </div>
      <div className="mt-1 flex items-center gap-3">
        <StatusBadge status={entry.status} />
        {subtreeCount > 1 && (
          <span className="text-[11.5px] text-ink-faint">
            {subtreeCount} ADRs in run
          </span>
        )}
      </div>
      {entry.status === 'failed' && entry.evidence.length > 0 && (
        <ul className="mt-2 space-y-0.5 rounded-md bg-status-failed/5 px-2.5 py-1.5">
          {entry.evidence.map((line, i) => (
            <li key={i} className="break-words font-mono text-[11px] text-status-failed">
              {line}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function HistoryDrawer() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<RunHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch fresh on every open so a run just finished in the editor shows up.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRuns(null);
    setError(null);
    getRuns()
      .then((list) => !cancelled && setRuns(sortRunsNewestFirst(list)))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const openRun = useCallback(
    (entry: RunHistoryEntry) => {
      setOpen(false);
      navigate(adrRoute(entry.rootRelPath));
    },
    [navigate],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium text-ink-muted transition-colors hover:bg-line-soft"
      >
        <span className="text-ink-faint">
          <ClockIcon />
        </span>
        Run history
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-ink/20"
          onMouseDown={() => setOpen(false)}
          role="presentation"
        >
          <aside
            className="flex h-full w-80 flex-col border-l border-line bg-paper shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Run history"
          >
            <div className="flex items-center justify-between border-b border-line-hair px-4 py-3">
              <h2 className="text-[14px] font-semibold text-ink">Run history</h2>
              <IconButton aria-label="Close run history" onClick={() => setOpen(false)}>
                ✕
              </IconButton>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {error ? (
                <p className="px-4 py-6 text-[13px] text-status-failed">{error}</p>
              ) : runs == null ? (
                <p className="px-4 py-6 text-[13px] text-ink-subtle">Loading…</p>
              ) : runs.length === 0 ? (
                <p className="px-4 py-6 text-[13px] text-ink-subtle">
                  No runs yet. Run an ADR to see it here.
                </p>
              ) : (
                <ul>
                  {runs.map((entry) => (
                    <RunRow key={entry.id} entry={entry} onOpen={() => openRun(entry)} />
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
