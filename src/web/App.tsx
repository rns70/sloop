import { Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom';
import { AppShell } from './shell/AppShell';
import { EmptyPane } from './shell/EmptyPane';
import { AdrEditor } from './views/databank/AdrEditor';
import { CascadeProvider } from './views/mission-control/CascadeContext';
import { CascadeView } from './views/mission-control/CascadeView';
import { LoopPage } from './views/loop/LoopPage';
import { LibraryFile } from './views/libraries/LibraryFile';
import { AssistantProvider } from './assistant/AssistantContext';

/**
 * One CascadeProvider spans a cascade's tree AND its loop pages (nested routes share
 * this Outlet), so navigating between Mission Control and a loop keeps a single live
 * WebSocket subscription and output buffer.
 */
function CascadeLayout() {
  const { id = '' } = useParams();
  return (
    <CascadeProvider id={id}>
      <Outlet />
    </CascadeProvider>
  );
}

/**
 * Routing for the sloop web app. The AppShell is the layout (sidebar + content);
 * Databank is built in WP-4, Mission Control / Loop / Libraries in WP-5. The "kick off
 * cascade" flow (KickoffMenu) routes to /cascades/:id.
 */
export default function App() {
  return (
    <AssistantProvider>
      <Routes>
        <Route element={<AppShell />}>
        <Route index element={<Navigate to="/databank" replace />} />
        <Route
          path="databank"
          element={<EmptyPane section="Databank" hint="Select an entry from the sidebar." />}
        />
        <Route path="databank/*" element={<AdrEditor />} />
        <Route
          path="cascades"
          element={
            <EmptyPane section="Cascades" hint="Kick off a cascade, or pick a run from the sidebar." />
          }
        />
        <Route path="cascades/:id" element={<CascadeLayout />}>
          <Route index element={<CascadeView />} />
          <Route path="loops/:loopId" element={<LoopPage />} />
        </Route>
        <Route
          path="libraries"
          element={
            <EmptyPane section="Libraries" hint="Select a role or template from the sidebar." />
          }
        />
        <Route path="libraries/:type/:id" element={<LibraryFile />} />
        <Route path="*" element={<Navigate to="/databank" replace />} />
        </Route>
      </Routes>
    </AssistantProvider>
  );
}
