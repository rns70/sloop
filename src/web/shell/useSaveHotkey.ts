// Global Cmd+S (Ctrl+S) handler. Lives at the app shell rather than per-editor so there
// is exactly one listener, and so it can swallow the browser's "save page" dialog whenever
// a document is open — even when the dirty/disabled state means the save itself is a no-op.

import { useEffect } from 'react';
import { useSaveAction } from './EditorActionsContext';

export function useSaveHotkey(): void {
  const saveAction = useSaveAction();

  useEffect(() => {
    if (!saveAction) return; // no document open → let the browser keep its default
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.key !== 's' && e.key !== 'S') return;
      e.preventDefault(); // always suppress the browser save dialog while editing
      if (saveAction.canSave) saveAction.save();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveAction]);
}
