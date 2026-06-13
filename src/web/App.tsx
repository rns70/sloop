import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './shell/AppShell';
import { EmptyPane } from './shell/EmptyPane';
import { AdrEditor } from './views/databank/AdrEditor';
import { LibraryFile } from './views/libraries/LibraryFile';
import { AssistantProvider } from './assistant/AssistantContext';

/**
 * Routing for the sloop web app. The AppShell is the layout (sidebar + content). The
 * loops tree is the primary surface: a loop is the unit of execution (run it + its subtree
 * from the editor's run panel), so there is no separate cascade/mission-control route.
 * Roles/workflows live under Libraries.
 */
export default function App() {
  return (
    <AssistantProvider>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/loops" replace />} />
          <Route
            path="loops"
            element={<EmptyPane section="Loops" hint="Select an entry from the sidebar." />}
          />
          <Route path="loops/*" element={<AdrEditor />} />
          <Route
            path="libraries"
            element={
              <EmptyPane section="Libraries" hint="Select a role or workflow from the sidebar." />
            }
          />
          <Route path="libraries/:type/:id" element={<LibraryFile />} />
          <Route path="*" element={<Navigate to="/loops" replace />} />
        </Route>
      </Routes>
    </AssistantProvider>
  );
}
