import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './shell/AppShell';
import { CascadePlaceholder, Placeholder } from './shell/Placeholder';
import { DatabankList } from './views/databank/DatabankList';
import { AdrEditor } from './views/databank/AdrEditor';

/**
 * Routing for the sloop web app. The AppShell is the layout (sidebar + content);
 * Databank is fully built here, while Cascades and Libraries are placeholders WP-5
 * fills in. The "kick off cascade" flow routes to /cascades/:id.
 */
export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/databank" replace />} />
        <Route path="databank" element={<DatabankList />} />
        <Route path="databank/:file" element={<AdrEditor />} />
        <Route path="cascades" element={<Placeholder section="Cascades" />} />
        <Route path="cascades/:id" element={<CascadePlaceholder />} />
        <Route path="libraries/*" element={<Placeholder section="Libraries" />} />
        <Route path="*" element={<Navigate to="/databank" replace />} />
      </Route>
    </Routes>
  );
}
