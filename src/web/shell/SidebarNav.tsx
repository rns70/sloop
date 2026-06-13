// The sidebar navigation tree. File-backed sections list their files directly: Databank
// is a nested folder tree (see DatabankTree), Roles/Workflows are flat lists. Each section
// can create new items inline — a quiet, hover-revealed "+" on its header (Notion-style);
// Databank also gets a "new folder". Lists refresh on every navigation, so a freshly-created
// item shows up immediately.
//
// Every row also carries a right-click context menu (see ContextMenu): Rename (inline) +
// Duplicate + Delete. Rename reuses the same move/inline-edit path as double-click;
// Duplicate/Delete are client-side calls.

import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  deleteAdr,
  deleteFile,
  getAdrs,
  getRoles,
  getWorkflows,
  moveAdr,
  ApiError,
  type AdrDoc,
  type RoleDef,
  type WorkflowDef,
} from '../api-client/index';
import { IconButton, cx } from '../design/index';
import { DatabankTree } from './DatabankTree';
import {
  createDatabankItem,
  createLibraryItem,
  duplicateDatabankItem,
  duplicateLibraryItem,
  libraryFilePath,
  renameLibraryItem,
  slugify,
  type LibKind,
} from './createItem';
import { ContextMenuProvider, useContextMenu, type MenuEntry } from './ContextMenu';

/** A single flat-list row. `menu`/`onRename` opt the row into a right-click context menu and
 *  inline rename respectively; without them it is a plain link. */
interface Leaf {
  to: string;
  label: string;
  onRename?: (next: string) => void;
  menu?: (helpers: { rename: () => void }) => MenuEntry[];
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

/** A flat-list row: a NavLink that opens its context menu on right-click, swapping to an
 *  inline rename input while renaming. */
function NavRow({ leaf }: { leaf: Leaf }) {
  const { openMenu } = useContextMenu();
  const [renaming, setRenaming] = useState(false);

  if (renaming && leaf.onRename) {
    return (
      <FlatRenameInput
        initial={leaf.label}
        onSubmit={(name) => {
          setRenaming(false);
          leaf.onRename?.(name);
        }}
        onCancel={() => setRenaming(false)}
      />
    );
  }

  return (
    <NavLink
      to={leaf.to}
      className={leafClass}
      title={leaf.label}
      onContextMenu={(e) => leaf.menu && openMenu(e, leaf.menu({ rename: () => setRenaming(true) }))}
    >
      {leaf.label}
    </NavLink>
  );
}

/** Inline rename input for a flat-list row, styled to match the row it replaces. */
function FlatRenameInput({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const commit = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== initial) onSubmit(trimmed);
    else onCancel();
  };
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') onCancel();
      }}
      className="block w-full rounded-md border border-line bg-paper px-2 py-1 text-[13px] text-ink outline-none"
    />
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
                items.map((leaf) => <NavRow key={leaf.to} leaf={leaf} />)
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
  const [workflows, setWorkflows] = useState<WorkflowDef[] | null>(null);
  const [errs, setErrs] = useState<{
    adrs?: string;
    roles?: string;
    workflows?: string;
  }>({});
  const [rootAddingFolder, setRootAddingFolder] = useState(false);
  // A rejected move (e.g. a name collision -> 409) is transient: the tree loaded fine,
  // so it gets its own dismissible notice instead of replacing the tree with "Failed to load".
  const [moveErr, setMoveErr] = useState<string | null>(null);
  // Bumped after an in-place mutation (delete/rename) that doesn't navigate, to re-fetch lists.
  const [reloadTick, setReloadTick] = useState(0);
  const reload = () => setReloadTick((t) => t + 1);

  const fail =
    (key: 'adrs' | 'roles' | 'workflows') => (e: unknown) =>
      setErrs((prev) => ({ ...prev, [key]: e instanceof Error ? e.message : String(e) }));

  // Refresh every list on navigation (and after an in-place mutation) so newly-created,
  // renamed, or deleted items show up immediately.
  useEffect(() => {
    let cancelled = false;
    setMoveErr(null); // a navigation means the stale move notice no longer applies
    getAdrs().then((v) => !cancelled && setAdrs(v)).catch(fail('adrs'));
    getRoles().then((v) => !cancelled && setRoles(v)).catch(fail('roles'));
    getWorkflows().then((v) => !cancelled && setWorkflows(v)).catch(fail('workflows'));
    return () => {
      cancelled = true;
    };
  }, [location.pathname, reloadTick]);

  // ---- Create handlers (navigate to the new item with ?new=1 to focus its title) ----
  const newAdr = (folder: string) => {
    void createDatabankItem((adrs ?? []).map((a) => a.relPath), folder)
      .then((sub) => navigate(`/loops/${sub}?new=1`))
      .catch(fail('adrs'));
  };
  const newFolder = (parent: string, name: string) => {
    const folder = parent ? `${parent}/${slugify(name)}` : slugify(name);
    void createDatabankItem((adrs ?? []).map((a) => a.relPath), folder)
      .then((sub) => navigate(`/loops/${sub}?new=1`))
      .catch(fail('adrs'));
  };
  const newLib = (kind: LibKind) => {
    const existing = (kind === 'roles' ? roles : workflows) ?? [];
    void createLibraryItem(kind, existing.map((x) => x.id))
      .then((id) => navigate(`/libraries/${kind}/${id}?new=1`))
      .catch(fail(kind));
  };

  // Move/rename a loops entry (file or folder prefix). On success, re-fetch the tree;
  // if the currently-open ADR was the one moved, follow it to its new URL so the editor
  // doesn't 404. `from`/`to` are loops-prefixed paths (e.g. loops/auth/a.md).
  const moveDatabank = (from: string, to: string) => {
    setMoveErr(null);
    const openPath = decodeURIComponent(location.pathname.replace(/^\/loops\//, ''));
    const openRel = `loops/${openPath}`;
    const toUrl = (rel: string) => `/loops/${rel.replace(/^loops\//, '')}`;
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
      .catch((e: unknown) => {
        // A name collision / type clash comes back as a 409 — surface the server's reason
        // inline and leave the tree intact. Anything else is a genuine failure of the section.
        if (e instanceof ApiError && e.status === 409) {
          setMoveErr(e.detail || 'That item already exists in the destination.');
        } else {
          fail('adrs')(e);
        }
      });
  };

  // Duplicate a loops file in place; route to the copy (focused for an immediate rename).
  const duplicateDatabank = (relPath: string) => {
    void duplicateDatabankItem((adrs ?? []).map((a) => a.relPath), relPath)
      .then((sub) => navigate(`/loops/${sub}?new=1`))
      .catch(fail('adrs'));
  };

  // Delete a loops file or folder subtree. If the open ADR was (under) it, leave the editor.
  const deleteDatabank = (relPath: string) => {
    void deleteAdr(relPath)
      .then(() => getAdrs())
      .then((next) => {
        setAdrs(next);
        if (location.pathname.startsWith('/loops/')) {
          const openRel = `loops/${decodeURIComponent(location.pathname.replace(/^\/loops\//, ''))}`;
          if (openRel === relPath || openRel.startsWith(`${relPath}/`)) navigate('/');
        }
      })
      .catch(fail('adrs'));
  };

  // ---- Library (role/workflow) menu handlers ----
  const duplicateLib = (kind: LibKind, item: RoleDef | WorkflowDef) => {
    const existing = (kind === 'roles' ? roles : workflows) ?? [];
    void duplicateLibraryItem(kind, item, existing.map((x) => x.id))
      .then((id) => navigate(`/libraries/${kind}/${id}?new=1`))
      .catch(fail(kind));
  };
  const renameLib = (kind: LibKind, item: RoleDef | WorkflowDef, name: string) => {
    void renameLibraryItem(kind, item, name).then(reload).catch(fail(kind));
  };
  const deleteLib = (kind: LibKind, item: RoleDef | WorkflowDef) => {
    void deleteFile(libraryFilePath(kind, item.id))
      .then(() => {
        if (location.pathname === `/libraries/${kind}/${enc(item.id)}`) navigate('/');
        else reload();
      })
      .catch(fail(kind));
  };

  const roleLeaves: Leaf[] | null =
    roles &&
    roles.map((r) => ({
      to: `/libraries/roles/${enc(r.id)}`,
      label: r.name,
      onRename: (name) => renameLib('roles', r, name),
      menu: ({ rename }) => [
        { label: 'Rename', onSelect: rename },
        { label: 'Duplicate', onSelect: () => duplicateLib('roles', r) },
        'separator',
        { label: 'Delete', danger: true, confirm: 'Delete role?', onSelect: () => deleteLib('roles', r) },
      ],
    }));
  const workflowLeaves: Leaf[] | null =
    workflows &&
    workflows.map((w) => ({
      to: `/libraries/workflows/${enc(w.id)}`,
      label: w.name,
      onRename: (name) => renameLib('workflows', w, name),
      menu: ({ rename }) => [
        { label: 'Rename', onSelect: rename },
        { label: 'Duplicate', onSelect: () => duplicateLib('workflows', w) },
        'separator',
        {
          label: 'Delete',
          danger: true,
          confirm: 'Delete workflow?',
          onSelect: () => deleteLib('workflows', w),
        },
      ],
    }));

  return (
    <ContextMenuProvider>
      <nav className="space-y-1">
        <NavGroup
          label="Databank"
          count={adrs?.length}
          error={errs.adrs ?? null}
          actions={
            adrs && (
              <>
                <IconButton aria-label="New loops entry" onClick={() => newAdr('')}>
                  <span className="text-[14px] leading-none">＋</span>
                </IconButton>
                <IconButton
                  aria-label="New loops folder"
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
            <>
              {moveErr && (
                <div
                  role="alert"
                  className="mb-1 flex items-start gap-2 rounded-md bg-status-failed/10 px-2 py-1 text-[12px] text-status-failed"
                >
                  <span className="min-w-0 flex-1 break-words">{moveErr}</span>
                  <button
                    type="button"
                    aria-label="Dismiss"
                    onClick={() => setMoveErr(null)}
                    className="shrink-0 leading-none text-status-failed/70 hover:text-status-failed"
                  >
                    ✕
                  </button>
                </div>
              )}
              <DatabankTree
                adrs={adrs}
                onNewItem={newAdr}
                onNewFolder={newFolder}
                onMove={moveDatabank}
                onDuplicate={duplicateDatabank}
                onDelete={deleteDatabank}
                rootAdding={rootAddingFolder}
                onRootAddingDone={() => setRootAddingFolder(false)}
              />
            </>
          )}
        </NavGroup>

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
          label="Workflows"
          items={workflowLeaves}
          error={errs.workflows ?? null}
          actions={
            workflows && (
              <IconButton aria-label="New workflow" onClick={() => newLib('workflows')}>
                <span className="text-[14px] leading-none">＋</span>
              </IconButton>
            )
          }
        />
      </nav>
    </ContextMenuProvider>
  );
}
