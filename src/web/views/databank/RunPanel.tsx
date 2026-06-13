// Mission control *inside* the ADR. A Run button hands this ADR + its subtree to a
// single agent; while the run is live this panel streams overall status, a compact
// subtree with each ADR's live status/criteria/output (AdrRunTree), and — once edits
// land — the committed inline diff. Runs are serialized server-side: a second request
// while one is active returns 409, surfaced inline.
//
// The event-accumulation logic lives in the pure `applyRunEvent` reducer (runState.ts),
// unit-tested without a DOM; this component is the React shell around it.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  getAdrRun,
  getAdrs,
  runAdr,
  subscribeToRun,
  type AdrDoc,
} from '../../api-client/index';
import { Button, Label, cx } from '../../design/index';
import { ApplyWorkflowButton } from './ApplyWorkflowButton';
import { AdrRunTree } from './AdrRunTree';
import { InlineDiff } from './InlineDiff';
import { adrStatusMeta } from './adrStatus';
import { applyRunEvent, initialRunSnapshot, type RunSnapshot } from './runState';

/** Collect the run-set (source ADR + recursive descendants by `children` relPath), guarding
 *  against cycles so a malformed graph can't loop forever. Depth-first, source first. */
function collectRunSet(adrs: AdrDoc[], root: AdrDoc): string[] {
  const byRelPath = new Map(adrs.map((a) => [a.relPath, a] as const));
  const out: string[] = [];
  const seen = new Set<string>();
  const walk = (adr: AdrDoc) => {
    if (seen.has(adr.relPath)) return;
    seen.add(adr.relPath);
    out.push(adr.relPath);
    for (const cPath of adr.children) {
      const child = byRelPath.get(cPath);
      if (child) walk(child);
    }
  };
  walk(root);
  return out;
}

export interface RunPanelProps {
  /** The ADR being run (the editor's currently-open doc). */
  adr: AdrDoc;
  /** Called after a workflow is stamped onto this ADR, so the editor can reload the open
   *  doc (its `children` just gained the new child relPaths). */
  onApplied?: () => void;
}

export function RunPanel({ adr, onApplied }: RunPanelProps) {
  // The full ADR list, used to render the subtree (resolve child ids → docs).
  const [adrs, setAdrs] = useState<AdrDoc[] | null>(null);
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set true after a finished run so we show the resulting committed diff.
  const [showDiff, setShowDiff] = useState(false);
  const unsubRef = useRef<(() => void) | null>(null);
  // Guards the rehydrate effect from re-subscribing to a run we already subscribed to —
  // whether the user clicked Run or we reconnected on mount. Tracks the subscribed runId
  // so a stale closure can't double-subscribe.
  const subscribedRunIdRef = useRef<string | null>(null);

  // Load the ADR list so the tree can resolve the subtree; cheap, refreshed when the open
  // ADR changes and after a workflow is applied (its new children must appear in the tree).
  const reloadAdrs = useCallback(() => {
    let cancelled = false;
    getAdrs()
      .then((list) => !cancelled && setAdrs(list))
      .catch(() => !cancelled && setAdrs([]));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => reloadAdrs(), [adr.relPath, reloadAdrs]);

  // Stamping a workflow rewrites this ADR's children + writes new child files; refresh the
  // tree locally and let the editor reload the open doc so both reflect the new subtree.
  const handleApplied = useCallback(() => {
    reloadAdrs();
    onApplied?.();
  }, [reloadAdrs, onApplied]);

  // Tear down any live subscription on unmount / when the open ADR changes, and reset the
  // subscription guard so the rehydrate effect can re-run for the next ADR.
  useEffect(() => {
    return () => {
      unsubRef.current?.();
      unsubRef.current = null;
      subscribedRunIdRef.current = null;
    };
  }, [adr.relPath]);

  // Subscribe to `runId` and fold its replayed + live events into the snapshot. Shared by
  // the Run button (fresh run) and the rehydrate effect (reconnect/replay). `live` seeds
  // the running flag; the replayed `done` event (for a finished run) flips it and reveals
  // the diff exactly as a freshly-finished run does. `seed` is the snapshot to fold into —
  // a run-set-seeded snapshot for a fresh run, or an empty one that events populate.
  const subscribe = useCallback((runId: string, live: boolean, seed: RunSnapshot) => {
    if (subscribedRunIdRef.current === runId) return; // already attached — don't double-subscribe
    unsubRef.current?.();
    subscribedRunIdRef.current = runId;
    setSnapshot(seed);
    setRunning(live);
    setShowDiff(false);

    const detach = () => {
      unsubRef.current?.();
      unsubRef.current = null;
      subscribedRunIdRef.current = null;
    };

    unsubRef.current = subscribeToRun(
      runId,
      (event) => {
        setSnapshot((cur) => applyRunEvent(cur ?? seed, event));
        if (event.type === 'done' || event.type === 'error') {
          setRunning(false);
          setShowDiff(event.type === 'done');
          detach();
        }
      },
      () => {
        setError('Lost connection to the run stream.');
        setRunning(false);
        detach();
      },
    );
  }, []);

  // Rehydrate on mount / when the open ADR changes: if no run is already attached, ask the
  // server whether this ADR has an active or finished run and reconnect to its event buffer.
  // The replayed status/output/eval/done events rebuild the panel as if it never unmounted.
  // Skipped once a local Run is in flight (subscribedRunIdRef is set by `subscribe`).
  useEffect(() => {
    let cancelled = false;
    if (subscribedRunIdRef.current) return; // a run is already attached for this ADR
    getAdrRun(adr.relPath)
      .then((ref) => {
        if (cancelled || !ref || subscribedRunIdRef.current) return;
        // Start from an empty snapshot; replayed events (incl. status) populate it fully.
        subscribe(ref.runId, ref.live, initialRunSnapshot([]));
      })
      .catch(() => {
        // Best-effort rehydration: a lookup failure just leaves the panel blank (the user
        // can still click Run). Don't surface an error for a missing/closed past run.
      });
    return () => {
      cancelled = true;
    };
  }, [adr.relPath, subscribe]);

  const start = useCallback(async () => {
    if (running) return;
    setError(null);
    setShowDiff(false);

    // Seed the snapshot from the known run-set so every ADR in the subtree shows as
    // `running` immediately, before its first server event arrives.
    const runSet = collectRunSet(adrs ?? [adr], adr);

    let runId: string;
    try {
      ({ runId } = await runAdr(adr.relPath));
    } catch (e: unknown) {
      // A run is already active (serialized server-side) → 409; surface it inline.
      if (e instanceof ApiError && e.status === 409) {
        setError(e.detail || 'Another run is already active. Wait for it to finish.');
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
      setRunning(false);
      setSnapshot(null);
      return;
    }

    subscribe(runId, true, initialRunSnapshot(runSet));
  }, [adrs, adr, running, subscribe]);

  const runStateOf = useCallback(
    (relPath: string) => snapshot?.byPath[relPath],
    [snapshot],
  );

  const outcome = snapshot?.outcome ?? null;
  const overallMeta = adrStatusMeta(running ? 'running' : outcome ?? adr.status);

  return (
    <section className="mb-6 rounded-lg border border-line p-4">
      <div className="flex items-center justify-between">
        <Label>Run</Label>
        <div className="flex items-center gap-3">
          {(running || outcome) && (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-muted">
              <span className={cx('text-[8px] leading-none', overallMeta.dotClass)} aria-hidden>
                ●
              </span>
              {running ? 'Running…' : overallMeta.label}
            </span>
          )}
          <ApplyWorkflowButton relPath={adr.relPath} onApplied={handleApplied} disabled={running} />
          <Button variant="primary" onClick={() => void start()} disabled={running}>
            {running ? 'Running…' : 'Run'}
          </Button>
        </div>
      </div>

      <p className="mt-1.5 text-[12.5px] text-ink-faint">
        Hands this ADR and its subtree to an agent that edits code until the acceptance
        criteria pass. Runs are serialized — only one at a time.
      </p>

      {error && (
        <div
          role="alert"
          className="mt-3 rounded-md bg-status-failed/10 px-3 py-2 text-[12.5px] text-status-failed"
        >
          {error}
        </div>
      )}

      {adrs && (snapshot || adr.children.length > 0) && (
        <div className="mt-4 overflow-hidden rounded-lg border border-line">
          <AdrRunTree adrs={adrs} root={adr} runStateOf={runStateOf} />
        </div>
      )}

      {showDiff && outcome && (
        <div className="mt-5">
          <Label>Changes</Label>
          <p className="mb-2 mt-1 text-[12.5px] text-ink-faint">
            {outcome === 'passed'
              ? 'Criteria passed — these edits were applied to the working tree.'
              : 'Run failed — edits and evidence are left in place for inspection.'}
          </p>
          <InlineDiff relPath={adr.relPath} />
        </div>
      )}
    </section>
  );
}
