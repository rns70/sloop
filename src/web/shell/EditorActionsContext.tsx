// A tiny registry the active editor publishes its Save into, so app-level surfaces can
// trigger it without prop-drilling: the global Cmd+S hotkey and the command palette's
// "Save current document" both read this. Mirrors the assistant's registerOpenDoc pattern
// — exactly one editor is mounted at a time, so a single slot (not a stack) is enough.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

/** The active document's save, surfaced for app-level triggers. `null` when none is open. */
export interface SaveAction {
  /** Whether saving would do anything (dirty and not already in flight). */
  canSave: boolean;
  /** Persist the current document. Safe to call when `canSave` is false (no-op upstream). */
  save: () => void;
}

interface EditorActionsValue {
  saveAction: SaveAction | null;
  setSaveAction: (action: SaveAction | null) => void;
}

const EditorActionsContext = createContext<EditorActionsValue | null>(null);

export function EditorActionsProvider({ children }: { children: ReactNode }) {
  const [saveAction, setSaveAction] = useState<SaveAction | null>(null);
  // setSaveAction from useState is already stable; wrap nothing else here.
  return (
    <EditorActionsContext.Provider value={{ saveAction, setSaveAction }}>
      {children}
    </EditorActionsContext.Provider>
  );
}

function useEditorActions(): EditorActionsValue {
  const ctx = useContext(EditorActionsContext);
  if (!ctx) throw new Error('useEditorActions must be used within an EditorActionsProvider');
  return ctx;
}

/** Read the active editor's save action (null when no document is open). */
export function useSaveAction(): SaveAction | null {
  return useEditorActions().saveAction;
}

/**
 * Register the calling editor's save with the app shell for its lifetime. `save` may be a
 * fresh closure each render (it captures editor state) — we hold it in a ref so the
 * registration only re-fires when `canSave` flips, not on every keystroke. Clears the slot
 * on unmount so a stale handler never lingers after navigating away.
 */
export function useRegisterSave(save: () => void, canSave: boolean): void {
  const { setSaveAction } = useEditorActions();
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    setSaveAction({ canSave, save: () => saveRef.current() });
    return () => setSaveAction(null);
  }, [canSave, setSaveAction]);
}
