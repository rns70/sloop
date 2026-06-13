import { Outlet } from 'react-router-dom';
import { KickoffMenu } from './KickoffMenu';
import { SidebarNav } from './SidebarNav';
import { AssistantRail } from './AssistantRail';
import { CommandPalette } from './CommandPalette';
import { EditorActionsProvider } from './EditorActionsContext';
import { useSaveHotkey } from './useSaveHotkey';

/**
 * The app shell: a quiet left sidebar (the only navigation — no top tabs) plus the
 * routed content area. The sidebar carries the logo, the global "kick off cascade"
 * affordance, and the navigation tree — file-backed sections list their files inline
 * (see SidebarNav), so a click opens a file directly with no overview page in between.
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

function ShellChrome() {
  useSaveHotkey();
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-paper font-sans text-ink antialiased">
      <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-line-hair bg-sidebar px-2.5 py-3">
        <div className="flex items-center gap-1.5 px-2 pb-3 text-[14px] font-semibold">
          <span className="text-ink-faint">◆</span> sloop
        </div>

        <KickoffMenu />

        <div className="mt-3">
          <SidebarNav />
        </div>

        <div className="mt-auto px-2 pt-3 text-[11px] text-ink-subtle">
          Reconciling code to the databank.
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
