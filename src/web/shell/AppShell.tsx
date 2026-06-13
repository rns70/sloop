import { NavLink, Outlet } from 'react-router-dom';
import { cx } from '../design/index';
import { KickoffMenu } from './KickoffMenu';

const NAV = [
  { to: '/databank', label: 'Databank' },
  { to: '/cascades', label: 'Cascades' },
  { to: '/libraries', label: 'Libraries' },
];

function NavItem({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cx(
          'block rounded-md px-2 py-1 text-[13.5px] transition-colors',
          isActive ? 'bg-active font-medium text-ink' : 'text-ink-muted hover:bg-line-soft',
        )
      }
    >
      {label}
    </NavLink>
  );
}

/**
 * The app shell: a quiet left sidebar (the only navigation — no top tabs) plus the
 * routed content area. The sidebar carries the logo, the global "kick off cascade"
 * affordance, and the three top-level sections.
 */
export function AppShell() {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-paper font-sans text-ink antialiased">
      <aside className="flex w-56 shrink-0 flex-col border-r border-line-hair bg-sidebar px-2.5 py-3">
        <div className="flex items-center gap-1.5 px-2 pb-3 text-[14px] font-semibold">
          <span className="text-ink-faint">◆</span> sloop
        </div>

        <KickoffMenu />

        <nav className="mt-3 space-y-0.5">
          {NAV.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </nav>

        <div className="mt-auto px-2 pt-3 text-[11px] text-ink-subtle">
          Reconciling code to the databank.
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}
