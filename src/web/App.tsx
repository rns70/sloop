import { Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom';
import { AppShell } from './shell/AppShell';
import { DatabankList } from './views/databank/DatabankList';
import { AdrEditor } from './views/databank/AdrEditor';
import { CascadeProvider } from './views/mission-control/CascadeContext';
import { CascadesIndex } from './views/mission-control/CascadesIndex';
import { CascadeView } from './views/mission-control/CascadeView';
import { LoopPage } from './views/loop/LoopPage';
import { Libraries } from './views/libraries/Libraries';

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
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/databank" replace />} />
        <Route path="databank" element={<DatabankList />} />
        <Route path="databank/:file" element={<AdrEditor />} />
        <Route path="cascades" element={<CascadesIndex />} />
        <Route path="cascades/:id" element={<CascadeLayout />}>
          <Route index element={<CascadeView />} />
          <Route path="loops/:loopId" element={<LoopPage />} />
        </Route>
        <Route path="libraries/*" element={<Libraries />} />
        <Route path="*" element={<Navigate to="/databank" replace />} />
      </Route>
    </Routes>
  );
}
