import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * The open editor (if any) registers itself here so the shell-mounted AssistantRail can
 * auto-include the current doc as context. It also exposes a one-way channel
 * (`runAssistant`/`registerRunner`) so UI elsewhere — e.g. the missing-criteria shortcut —
 * can trigger an assistant run that surfaces in the rail as a normal chat turn. The rail
 * registers the runner on mount; `runAssistant` is a no-op when no rail is mounted.
 */
export interface OpenDoc {
  relPath: string;
  getValue: () => string;
  applyInline: (originalText: string, replacement: string) => void;
}

/**
 * Broadcast of the paths the assistant just wrote to disk. The monotonic `seq` makes
 * every write a distinct value so repeat writes to the *same* path still notify watchers.
 * An open editor compares its own path against `paths` and refetches in place, so an
 * in-place edit (e.g. the "Add with assistant" criteria shortcut, which writes via the
 * API rather than the inline-diff channel) doesn't leave the editor showing stale content.
 */
export interface WriteSignal {
  paths: string[];
  seq: number;
}

/** Next write signal after the assistant wrote `paths`. Empty writes are ignored
 *  (the previous signal is kept). Pure + exported for unit testing. */
export function nextWriteSignal(prev: WriteSignal | null, paths: string[]): WriteSignal | null {
  if (paths.length === 0) return prev;
  return { paths, seq: (prev?.seq ?? 0) + 1 };
}

/** Whether a write signal touched `relPath`. Pure + exported for unit testing. */
export function signalTouches(signal: WriteSignal | null, relPath: string): boolean {
  return signal !== null && signal.paths.includes(relPath);
}

interface AssistantContextValue {
  openDoc: OpenDoc | null;
  registerOpenDoc: (doc: OpenDoc | null) => void;
  runAssistant: (instruction: string) => void;
  registerRunner: (fn: ((instruction: string) => void) | null) => void;
  /** Latest paths the assistant wrote to disk; open editors watch this to refetch in place. */
  writeSignal: WriteSignal | null;
  /** Announce that the assistant wrote `paths` to disk (called by the rail's onWrote). */
  notifyWrote: (paths: string[]) => void;
}

const Ctx = createContext<AssistantContextValue | null>(null);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [openDoc, setOpenDoc] = useState<OpenDoc | null>(null);
  const registerOpenDoc = useCallback((doc: OpenDoc | null) => setOpenDoc(doc), []);

  const runnerRef = useRef<((instruction: string) => void) | null>(null);
  const registerRunner = useCallback(
    (fn: ((instruction: string) => void) | null) => {
      runnerRef.current = fn;
    },
    [],
  );
  const runAssistant = useCallback((instruction: string) => {
    runnerRef.current?.(instruction);
  }, []);

  const [writeSignal, setWriteSignal] = useState<WriteSignal | null>(null);
  const notifyWrote = useCallback((paths: string[]) => {
    setWriteSignal((prev) => nextWriteSignal(prev, paths));
  }, []);

  const value = useMemo(
    () => ({ openDoc, registerOpenDoc, runAssistant, registerRunner, writeSignal, notifyWrote }),
    [openDoc, registerOpenDoc, runAssistant, registerRunner, writeSignal, notifyWrote],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAssistant(): AssistantContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAssistant must be used within an AssistantProvider');
  return ctx;
}
