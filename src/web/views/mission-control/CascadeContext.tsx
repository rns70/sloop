// Single source of live cascade state, shared by the Mission Control tree and the
// Loop page so there is exactly one WebSocket subscription and one output buffer.
//
// Flow:
//   1. mount         → getCascade(id): root is `awaiting_approval`, leaves `planned`.
//   2. approve()     → approveCascade(id) flips leaves to `queued`, then we OPEN the
//                      WS. The backend buffers every event from kickoff, so a late
//                      subscriber catches up — but we still subscribe only after
//                      approval so the checkpoint is shown before execution starts.
//   3. loop-update   → replace the loop in place; the root loop flipping to `done` is
//                      the convergence "money shot".
//   4. output        → append chunk to that loop's buffer (streamed to the Loop page).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  approveCascade,
  getCascade,
  subscribeToCascade,
  type CascadeDetail,
  type CascadeStreamEvent,
  type LoopDoc,
  type LoopStatus,
} from '../../api-client/index';

interface CascadeContextValue {
  id: string;
  detail: CascadeDetail | null;
  error: string | null;
  /** True once the user approved the checkpoint (gates the checkpoint independently of
   *  loop status, since the architect stays `awaiting_approval` until the end). */
  approved: boolean;
  streaming: boolean;
  outputs: Record<string, string>;
  /** Derived from the root loop, per spec §3 ("status … derived, not just stored"). */
  rootStatus: LoopStatus | null;
  loops: LoopDoc[];
  loopById: (loopId: string) => LoopDoc | undefined;
  approve: () => Promise<void>;
}

const Ctx = createContext<CascadeContextValue | null>(null);

export function useCascade(): CascadeContextValue {
  const value = useContext(Ctx);
  if (!value) throw new Error('useCascade must be used within <CascadeProvider>');
  return value;
}

export function CascadeProvider({ id, children }: { id: string; children: ReactNode }) {
  const [detail, setDetail] = useState<CascadeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [outputs, setOutputs] = useState<Record<string, string>>({});
  const unsubRef = useRef<(() => void) | null>(null);

  // (Re)load whenever the cascade id changes; tear down any prior stream.
  useEffect(() => {
    let active = true;
    setDetail(null);
    setError(null);
    setApproved(false);
    setStreaming(false);
    setOutputs({});

    getCascade(id)
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      active = false;
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [id]);

  const applyEvent = useCallback((ev: CascadeStreamEvent) => {
    if (ev.type === 'loop-update') {
      setDetail((d) =>
        d
          ? {
              ...d,
              loops: d.loops.map((l) =>
                l.frontmatter.id === ev.loop.frontmatter.id ? ev.loop : l,
              ),
            }
          : d,
      );
    } else {
      setOutputs((o) => ({ ...o, [ev.loopId]: (o[ev.loopId] ?? '') + ev.chunk }));
    }
  }, []);

  const approve = useCallback(async () => {
    await approveCascade(id);
    // Re-read so leaves reflect their queued state before the stream animates them.
    const refreshed = await getCascade(id);
    setDetail(refreshed);
    setApproved(true);
    setStreaming(true);
    unsubRef.current?.();
    unsubRef.current = subscribeToCascade(id, applyEvent, () => setStreaming(false));
  }, [id, applyEvent]);

  const loops = detail?.loops ?? [];

  const value = useMemo<CascadeContextValue>(() => {
    const rootId = detail?.summary.rootLoopId;
    const root = rootId ? loops.find((l) => l.frontmatter.id === rootId) : undefined;
    return {
      id,
      detail,
      error,
      approved,
      streaming,
      outputs,
      rootStatus: root?.frontmatter.status ?? detail?.summary.status ?? null,
      loops,
      loopById: (loopId) => loops.find((l) => l.frontmatter.id === loopId),
      approve,
    };
  }, [id, detail, error, approved, streaming, outputs, loops, approve]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
