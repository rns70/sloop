// The sidebar navigation tree. File-backed sections list their files directly: Databank
// is a nested folder tree (see DatabankTree), Roles/Templates are flat lists, Cascades is
// a live run list. Each section can create new items inline — a quiet, hover-revealed "+"
// on its header (Notion-style); Databank also gets a "new folder". Lists refresh on every
// navigation, so a freshly-created item (or kicked-off cascade) shows up immediately.

import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  getAdrs,
  getCascades,
  getRoles,
  getTemplates,
  moveAdr,
  type AdrDoc,
  type CascadeSummary,
  type RoleDef,
  type TemplateDef,
} from '../api-client/index';
import { IconButton, cx } from '../design/index';
import { humanizeCascade } from '../views/mission-control/text';
import { DatabankTree } from './DatabankTree';
import { createDatabankItem, createLibraryItem, slugify, type LibKind } from './createItem';

/** A single file row target. */
interface Leaf {
  to: string;
  label: string;
}

const enc = encodeURIComponent;

/** A small folder glyph for the "new folder" affordance. */
function FolderPlusIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path
        d="M1.75 4.25a1 1 0 0 1 1-1h2.8l1.4 1.4h6.3a1 1 0 0 1 1 1v5.6a1 1 0 0 1-1 1H2.75a1 1 0 0 1-1-1z"
        strokeLinejoin="round"
      />
      <path d="M8 7.4v3.2M6.4 9h3.2" strokeLinecap="round" />
    </svg>
  );
}

function leafClass({ isActive }: { isActive: boolean }): string {
  return cx(
    'block truncate rounded-md px-2 py-1 text-[13px] transition-colors',
    isActive ? 'bg-active font-medium text-ink' : 'text-ink-muted hover:bg-line-soft',
  );
}

/**
 * One collapsible section. The header toggles expansion and carries an optional count and
 * hover-revealed `actions` (e.g. create buttons). The body is either the default flat
 * `items` list or custom `children` (the Databank tree).
 */
function NavGroup({
  label,
  count,
  items,
  error,
  actions,
  children,
}: {
  label: string;
  count?: number;
  items?: Leaf[] | null;
  error?: string | null;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const shownCount = count ?? (items ? items.length : undefined);

  return (
    <div>
      <div className="group/hdr flex items-center gap-1 rounded-md pr-1 hover:bg-line-soft">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-[13px] text-ink-muted"
        >
          <span
            aria-hidden
            className={cx(
              'text-[9px] leading-none text-ink-faint transition-transform',
              open ? 'rotate-90' : 'rotate-0',
            )}
          >
            ▶
          </span>
          <span className="truncate font-medium">{label}</span>
        </button>
        {shownCount != null && (
          <span className="text-[11px] tabular-nums text-ink-subtle group-hover/hdr:hidden">
            {shownCount}
          </span>
        )}
        {actions && (
          <div className="hidden items-center group-hover/hdr:flex">{actions}</div>
        )}
      </div>

      {open && (
        <div className="mb-1 mt-0.5 pl-3.5">
          {children ?? (
            <div className="space-y-0.5">
              {error ? (
                <p className="px-2 py-1 text-[12px] text-status-failed">Failed to load</p>
              ) : items == null ? (
                <p className="px-2 py-1 text-[12px] text-ink-subtle">Loading…</p>
              ) : items.length === 0 ? (
                <p className="px-2 py-1 text-[12px] text-ink-subtle">None yet</p>
              ) : (
                items.map((leaf) => (
                  <NavLink key={leaf.to} to={leaf.to} className={leafClass} title={leaf.label}>
                    {leaf.label}
                  </NavLink>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SidebarNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const [adrs, setAdrs] = useState<AdrDoc[] | null>(null);
  const [roles, setRoles] = useState<RoleDef[] | null>(null);
  const [templates, setTemplates] = useState<TemplateDef[] | null>(null);
  const [cascades, setCascades] = useState<CascadeSummary[] | null>(null);
  const [errs, setErrs] = useState<{
    adrs?: string;
    roles?: string;
    templates?: string;
    cascades?: string;
  }>({});
  const [rootAddingFolder, setRootAddingFolder] = useState(false);

  const fail =
    (key: 'adrs' | 'roles' | 'templates' | 'cascades') => (e: unknown) =>
      setErrs((prev) => ({ ...prev, [key]: e instanceof Error ? e.message : String(e) }));

  // Refresh every list on navigation so newly-created items / kicked-off cascades appear
  // (creation always navigates to the new item, which changes the pathname).
  useEffect(() => {
    let cancelled = false;
    getAdrs().then((v) => !cancelled && setAdrs(v)).catch(fail('adrs'));
    getRoles().then((v) => !cancelled && setRoles(v)).catch(fail('roles'));
    getTemplates().then((v) => !cancelled && setTemplates(v)).catch(fail('templates'));
    getCascades().then((v) => !cancelled && setCascades(v)).catch(fail('cascades'));
    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  // ---- Create handlers (navigate to the new item with ?new=1 to focus its title) ----
  const newAdr = (folder: string) => {
    void createDatabankItem((adrs ?? []).map((a) => a.relPath), folder)
      .then((sub) => navigate(`/databank/${sub}?new=1`))
      .catch(fail('adrs'));
  };
  const newFolder = (parent: string, name: string) => {
    const folder = parent ? `${parent}/${slugify(name)}` : slugify(name);
    void createDatabankItem((adrs ?? []).map((a) => a.relPath), folder)
      .then((sub) => navigate(`/databank/${sub}?new=1`))
      .catch(fail('adrs'));
  };
  const newLib = (kind: LibKind) => {
    const existing = (kind === 'roles' ? roles : templates) ?? [];
    void createLibraryItem(kind, existing.map((x) => x.id))
      .then((id) => navigate(`/libraries/${kind}/${id}?new=1`))
      .catch(fail(kind));
  };

  // Move/rename a databank entry (file or folder prefix). On success, re-fetch the tree;
  // if the currently-open ADR was the one moved, follow it to its new URL so the editor
  // doesn't 404. `from`/`to` are databank-prefixed paths (e.g. databank/auth/a.md).
  const moveDatabank = (from: string, to: string) => {
    const openPath = decodeURIComponent(location.pathname.replace(/^\/databank\//, ''));
    const openRel = `databank/${openPath}`;
    const toUrl = (rel: string) => `/databank/${rel.replace(/^databank\//, '')}`;
    void moveAdr(from, to)
      .then(() => getAdrs())
      .then((next) => {
        setAdrs(next);
        // File rename/move: exact match. Folder move: the open file sat under `from/`.
        if (openRel === from) {
          navigate(toUrl(to));
        } else if (openRel.startsWith(`${from}/`)) {
          navigate(toUrl(`${to}/${openRel.slice(from.length + 1)}`));
        }
      })
      .catch(fail('adrs'));
  };

  const cascadeLeaves: Leaf[] | null =
    cascades &&
    cascades.map((c) => ({ to: `/cascades/${enc(c.id)}`, label: humanizeCascade(c.id) }));
  const roleLeaves: Leaf[] | null =
    roles && roles.map((r) => ({ to: `/libraries/roles/${enc(r.id)}`, label: r.name }));
  const templateLeaves: Leaf[] | null =
    templates && templates.map((t) => ({ to: `/libraries/templates/${enc(t.id)}`, label: t.name }));

  return (
    <nav className="space-y-1">
      <NavGroup
        label="Databank"
        count={adrs?.length}
        error={errs.adrs ?? null}
        actions={
          adrs && (
            <>
              <IconButton aria-label="New databank entry" onClick={() => newAdr('')}>
                <span className="text-[14px] leading-none">＋</span>
              </IconButton>
              <IconButton
                aria-label="New databank folder"
                onClick={() => setRootAddingFolder(true)}
              >
                <FolderPlusIcon />
              </IconButton>
            </>
          )
        }
      >
        {errs.adrs ? (
          <p className="px-2 py-1 text-[12px] text-status-failed">Failed to load</p>
        ) : adrs == null ? (
          <p className="px-2 py-1 text-[12px] text-ink-subtle">Loading…</p>
        ) : (
          <DatabankTree
            adrs={adrs}
            onNewItem={newAdr}
            onNewFolder={newFolder}
            onMove={moveDatabank}
            rootAdding={rootAddingFolder}
            onRootAddingDone={() => setRootAddingFolder(false)}
          />
        )}
      </NavGroup>

      <NavGroup label="Cascades" items={cascadeLeaves} error={errs.cascades ?? null} />

      <NavGroup
        label="Roles"
        items={roleLeaves}
        error={errs.roles ?? null}
        actions={
          roles && (
            <IconButton aria-label="New role" onClick={() => newLib('roles')}>
              <span className="text-[14px] leading-none">＋</span>
            </IconButton>
          )
        }
      />

      <NavGroup
        label="Templates"
        items={templateLeaves}
        error={errs.templates ?? null}
        actions={
          templates && (
            <IconButton aria-label="New template" onClick={() => newLib('templates')}>
              <span className="text-[14px] leading-none">＋</span>
            </IconButton>
          )
        }
      />
    </nav>
  );
}
