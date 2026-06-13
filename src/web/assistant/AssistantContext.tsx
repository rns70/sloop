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

interface AssistantContextValue {
  openDoc: OpenDoc | null;
  registerOpenDoc: (doc: OpenDoc | null) => void;
  runAssistant: (instruction: string) => void;
  registerRunner: (fn: ((instruction: string) => void) | null) => void;
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

  const value = useMemo(
    () => ({ openDoc, registerOpenDoc, runAssistant, registerRunner }),
    [openDoc, registerOpenDoc, runAssistant, registerRunner],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAssistant(): AssistantContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAssistant must be used within an AssistantProvider');
  return ctx;
}
