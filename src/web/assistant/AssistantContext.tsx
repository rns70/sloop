import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * The open editor (if any) registers itself here so the shell-mounted AssistantRail can:
 *  - auto-include the current doc as context, and
 *  - hand an edit of THAT doc back to the editor's inline accept/reject diff (`applyInline`)
 *    instead of writing through the API.
 */
export interface OpenDoc {
  relPath: string;
  getValue: () => string;
  applyInline: (originalText: string, replacement: string) => void;
}

interface AssistantContextValue {
  openDoc: OpenDoc | null;
  registerOpenDoc: (doc: OpenDoc | null) => void;
}

const Ctx = createContext<AssistantContextValue | null>(null);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [openDoc, setOpenDoc] = useState<OpenDoc | null>(null);
  const registerOpenDoc = useCallback((doc: OpenDoc | null) => setOpenDoc(doc), []);
  const value = useMemo(() => ({ openDoc, registerOpenDoc }), [openDoc, registerOpenDoc]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAssistant(): AssistantContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAssistant must be used within an AssistantProvider');
  return ctx;
}
