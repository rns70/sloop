import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { HistoryDrawer } from './HistoryDrawer';
import { SidebarNav } from './SidebarNav';
import { AssistantRail } from './AssistantRail';
import { CommandPalette } from './CommandPalette';
import { EditorActionsProvider } from './EditorActionsContext';
import { useSaveHotkey } from './useSaveHotkey';
import { getHealth } from '../api-client/index';

/**
 * The app shell: a quiet left sidebar (the only navigation — no top tabs) plus the
 * routed content area. The sidebar carries the logo, the run-history drawer trigger,
 * and the navigation tree — file-backed sections list their files inline (see SidebarNav),
 * so a click opens a file directly with no overview page in between.
 *
 * Global keyboard surfaces live here so they span every view: Cmd+S saves the open
 * document (useSaveHotkey) and Cmd+K opens the command palette. Both read the active
 * editor's save through EditorActionsProvider, which wraps the routed content.
 */
export function AppShell() {
  return (
    <EditorActionsProvider>
      <ShellChrome />
    </EditorActionsProvider>
  );
}

/** The active workspace's directory name (the last path segment), or null until the
 *  /api/health probe resolves. We show just the basename in the shell and keep the full
 *  absolute path on the title attribute for when the user needs the whole thing. */
function useWorkspaceName(): { name: string; path: string } | null {
  const [ws, setWs] = useState<{ name: string; path: string } | null>(null);
  useEffect(() => {
    let alive = true;
    getHealth()
      .then(({ workspace }) => {
        if (!alive) return;
        const name = workspace.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || workspace;
        setWs({ name, path: workspace });
      })
      .catch(() => {
        // Health probe failed; leave the workspace label hidden rather than show a guess.
      });
    return () => {
      alive = false;
    };
  }, []);
  return ws;
}

function ShellChrome() {
  useSaveHotkey();
  const workspace = useWorkspaceName();
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-paper font-sans text-ink antialiased">
      <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-line-hair bg-sidebar px-2.5 py-3">
        <div className="px-2 pb-3">
          <div className="flex items-center gap-1.5 text-[14px] font-semibold">
            <span className="text-ink-faint">◆</span> sloop
          </div>
          {workspace && (
            <div
              className="mt-0.5 truncate pl-[18px] text-[11px] text-ink-subtle"
              title={workspace.path}
            >
              {workspace.name}
            </div>
          )}
        </div>

        <HistoryDrawer />

        <div className="mt-3">
          <SidebarNav />
        </div>

        <div className="mt-auto px-2 pt-3 text-[11px] text-ink-subtle">
          Reconciling code to the loops.
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>

      <AssistantRail />
      <CommandPalette />
    </div>
  );
}
