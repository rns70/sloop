// A single shared right-click context menu for the sidebar. One provider renders one
// floating menu (via portal) at the pointer; rows call `openMenu(event, entries)` from the
// `useContextMenu` hook. Centralising it means one set of dismiss listeners and one portal
// instead of per-row menus. Destructive entries opt into a two-step in-menu confirm so a
// delete never fires on a single mis-click — no blocking window.confirm().

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../design/index';

/** One actionable row. `confirm` turns it into a two-step action: the first click swaps the
 *  label to `confirm` (danger-styled); the second within the same open menu runs `onSelect`. */
export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  confirm?: string;
}
/** A menu is a list of items and visual separators. */
export type MenuEntry = MenuItem | 'separator';

interface MenuState {
  x: number;
  y: number;
  entries: MenuEntry[];
}

interface ContextMenuApi {
  /** Open the menu at the event's pointer location with the given entries. Prevents the
   *  browser's native context menu. A no-op (still prevents default) if `entries` is empty. */
  openMenu: (event: { preventDefault: () => void; clientX: number; clientY: number }, entries: MenuEntry[]) => void;
}

const Ctx = createContext<ContextMenuApi | null>(null);

/** Access the shared menu opener. Must be rendered under a {@link ContextMenuProvider}. */
export function useContextMenu(): ContextMenuApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useContextMenu must be used within a ContextMenuProvider');
  return api;
}

export function ContextMenuProvider({ children }: { children: ReactNode }) {
  const [menu, setMenu] = useState<MenuState | null>(null);

  const openMenu: ContextMenuApi['openMenu'] = useCallback((event, entries) => {
    event.preventDefault();
    if (entries.length === 0) return;
    setMenu({ x: event.clientX, y: event.clientY, entries });
  }, []);

  const close = useCallback(() => setMenu(null), []);

  return (
    <Ctx.Provider value={{ openMenu }}>
      {children}
      {menu && <FloatingMenu menu={menu} onClose={close} />}
    </Ctx.Provider>
  );
}

function isItem(entry: MenuEntry): entry is MenuItem {
  return entry !== 'separator';
}

function FloatingMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });
  // Which entry index is awaiting its confirm second-click (only one at a time).
  const [confirming, setConfirming] = useState<number | null>(null);

  // Clamp into the viewport once the menu has measured its size, so an edge-of-screen
  // right-click doesn't push it off-screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 8;
    const x = Math.min(menu.x, window.innerWidth - width - pad);
    const y = Math.min(menu.y, window.innerHeight - height - pad);
    setPos({ x: Math.max(pad, x), y: Math.max(pad, y) });
  }, [menu]);

  // Dismiss on anything that signals the user moved on: outside pointer, Escape, scroll,
  // resize, or losing window focus.
  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const run = (item: MenuItem, index: number) => {
    if (item.confirm && confirming !== index) {
      setConfirming(index);
      return;
    }
    onClose();
    item.onSelect();
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-50 min-w-[160px] overflow-hidden rounded-lg border border-line bg-paper py-1 shadow-lg"
    >
      {menu.entries.map((entry, i) =>
        !isItem(entry) ? (
          // eslint-disable-next-line react/no-array-index-key
          <div key={`sep-${i}`} className="my-1 h-px bg-line-soft" />
        ) : (
          <button
            // eslint-disable-next-line react/no-array-index-key
            key={`item-${i}`}
            type="button"
            role="menuitem"
            onClick={() => run(entry, i)}
            className={cx(
              'block w-full px-3 py-1.5 text-left text-[13px] transition-colors hover:bg-line-soft',
              entry.danger || confirming === i ? 'text-status-failed' : 'text-ink',
            )}
          >
            {confirming === i ? (entry.confirm ?? entry.label) : entry.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
