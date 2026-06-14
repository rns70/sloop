// The Databank sidebar tree. Folders are derived purely from ADR file paths
// (loops/auth/adr-007.md → folder "auth"), so there are no empty directories and no
// folder endpoint — a folder exists exactly when it holds a file. Each folder and the
// root can spawn a new ADR (instant) or a new subfolder (name-first inline input, since a
// folder's name *is* its path). Navigation/refresh is the parent's job via callbacks.
//
// Files and folders also carry a right-click context menu (Rename / Duplicate / Delete, plus
// New entry / New folder on folders). Rename reuses the same inline-edit + move path as
// double-click; Duplicate/Delete call back to the parent (SidebarNav).

import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { AdrDoc, Delta } from '../api-client/index';
import { IconButton, cx } from '../design/index';
import { useContextMenu, type MenuEntry } from './ContextMenu';
import {
  fileMoveTarget,
  folderMoveTarget,
  fileRenameTarget,
  folderRenameTarget,
  isRedundantMove,
} from './movePaths';

interface FileLeaf {
  title: string;
  to: string;
  relPath: string; // loops-prefixed, e.g. loops/auth/a.md — the drag source + move identity
  delta?: Delta;   // set when this doc has a pending git change
}
interface FolderNode {
  name: string;
  path: string; // loops-relative, e.g. "auth" or "auth/oauth"
  folders: FolderNode[];
  files: FileLeaf[];
  hasChanges: boolean; // any descendant file has a pending change (for the collapsed-folder dot)
}

const enc = encodeURIComponent;

const DELTA_DOT: Record<Delta, { cls: string; label: string }> = {
  add: { cls: 'bg-diff-addAccent', label: 'Added' },
  change: { cls: 'bg-diff-changeAccent', label: 'Modified' },
  delete: { cls: 'bg-diff-delText', label: 'Deleted' },
};

/** A small colored dot marking a pending git change on a row. */
function DeltaDot({ delta, faint }: { delta: Delta; faint?: boolean }) {
  const { cls, label } = DELTA_DOT[delta];
  return (
    <span
      className={cx('h-1.5 w-1.5 shrink-0 rounded-full', cls, faint && 'opacity-50')}
      title={label}
      aria-label={label}
    />
  );
}

/** A folder node's loops-prefixed path. The root node ('') maps to `loops`. */
const folderRelPath = (nodePath: string) => (nodePath ? `loops/${nodePath}` : 'loops');

/** Build the folder/file tree from ADR relPaths, stamping each file's pending delta
 *  (from `changes`) and rolling that up to `hasChanges` on every ancestor folder. */
function buildTree(adrs: AdrDoc[], changes: Map<string, Delta>): FolderNode {
  const root: FolderNode = { name: '', path: '', folders: [], files: [], hasChanges: false };
  for (const adr of [...adrs].sort((a, b) => a.relPath.localeCompare(b.relPath))) {
    const sub = adr.relPath.replace(/^loops\//, '');
    const segments = sub.split('/');
    const fileName = segments.pop() ?? sub;
    const delta = changes.get(adr.relPath);
    let node = root;
    if (delta) node.hasChanges = true;
    let acc = '';
    for (const seg of segments) {
      acc = acc ? `${acc}/${seg}` : seg;
      let next = node.folders.find((f) => f.name === seg);
      if (!next) {
        next = { name: seg, path: acc, folders: [], files: [], hasChanges: false };
        node.folders.push(next);
      }
      node = next;
      if (delta) node.hasChanges = true;
    }
    const dirPrefix = segments.length ? `${segments.map(enc).join('/')}/` : '';
    node.files.push({
      title: adr.title || fileName,
      to: `/loops/${dirPrefix}${enc(fileName)}`,
      relPath: adr.relPath,
      delta,
    });
  }
  return root;
}

export interface DatabankTreeProps {
  adrs: AdrDoc[];
  /** Pending git change per loops doc (relPath -> delta), driving the sidebar dots. */
  changes: Map<string, Delta>;
  /** Create a new ADR inside `folder` ('' = root). */
  onNewItem: (folder: string) => void;
  /** Create a new subfolder named `name` under `parent` ('' = root). */
  onNewFolder: (parent: string, name: string) => void;
  /** Move/rename: `from`/`to` are loops-prefixed paths. */
  onMove: (from: string, to: string) => void;
  /** Duplicate the ADR at `relPath` (loops-prefixed). */
  onDuplicate: (relPath: string) => void;
  /** Delete the file or folder subtree at `relPath` (loops-prefixed). */
  onDelete: (relPath: string) => void;
  /** Whether the root-level "new folder" input is open (driven by the group header). */
  rootAdding: boolean;
  onRootAddingDone: () => void;
}

/** The callbacks the tree threads down to every Folder/FileRow. */
interface TreeActions {
  onNewItem: (folder: string) => void;
  onNewFolder: (parent: string, name: string) => void;
  onMove: (from: string, to: string) => void;
  onDuplicate: (relPath: string) => void;
  onDelete: (relPath: string) => void;
}

export function DatabankTree({
  adrs,
  changes,
  onNewItem,
  onNewFolder,
  onMove,
  onDuplicate,
  onDelete,
  rootAdding,
  onRootAddingDone,
}: DatabankTreeProps) {
  const root = buildTree(adrs, changes);
  const actions: TreeActions = { onNewItem, onNewFolder, onMove, onDuplicate, onDelete };
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const onDragStart = (e: DragStartEvent) => {
    setDragLabel(String(e.active.data.current?.label ?? ''));
  };
  const onDragEnd = (e: DragEndEvent) => {
    setDragLabel(null);
    const over = e.over;
    if (!over) return;
    const [kind, sourcePath] = String(e.active.id).split(/:(.+)/) as ['file' | 'folder', string];
    const destFolder = String(over.id).replace(/^drop:/, '');
    if (isRedundantMove(kind, sourcePath, destFolder)) return;
    const to =
      kind === 'file'
        ? fileMoveTarget(sourcePath, destFolder)
        : folderMoveTarget(sourcePath, destFolder);
    onMove(sourcePath, to);
  };

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <RootDrop>
        <div className="space-y-0.5">
          {rootAdding && (
            <FolderNameInput
              depth={0}
              onSubmit={(name) => {
                onNewFolder('', name);
                onRootAddingDone();
              }}
              onCancel={onRootAddingDone}
            />
          )}
          {root.folders.map((f) => (
            <Folder key={f.path} node={f} depth={0} actions={actions} />
          ))}
          {root.files.map((leaf) => (
            <FileRow key={leaf.to} leaf={leaf} depth={0} actions={actions} />
          ))}
          {root.folders.length === 0 && root.files.length === 0 && !rootAdding && (
            <p className="px-2 py-1 text-[12px] text-ink-subtle">No entries yet</p>
          )}
        </div>
      </RootDrop>
      <DragOverlay>
        {dragLabel != null && (
          <div className="rounded-md bg-paper px-2 py-1 text-[13px] text-ink shadow-md ring-1 ring-line">
            {dragLabel}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** The whole tree body is a drop target for moving items back to the loops root. */
function RootDrop({ children }: { children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'drop:loops' });
  return (
    <div ref={setNodeRef} className={cx('rounded-md', isOver && 'ring-1 ring-accent/50')}>
      {children}
    </div>
  );
}

const indent = (depth: number) => ({ paddingLeft: `${depth * 12 + 8}px` });

function Folder({ node, depth, actions }: { node: FolderNode; depth: number; actions: TreeActions }) {
  const { openMenu } = useContextMenu();
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const relPath = folderRelPath(node.path);

  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `drop:${relPath}` });
  const {
    setNodeRef: setDragRef,
    listeners,
    attributes,
    isDragging,
  } = useDraggable({ id: `folder:${relPath}`, data: { label: node.name } });

  if (renaming) {
    return (
      <RenameInput
        depth={depth}
        initial={node.name}
        onSubmit={(name) => {
          setRenaming(false);
          actions.onMove(relPath, folderRenameTarget(relPath, name));
        }}
        onCancel={() => setRenaming(false)}
      />
    );
  }

  const menu: MenuEntry[] = [
    {
      label: 'New entry',
      onSelect: () => {
        setOpen(true);
        actions.onNewItem(node.path);
      },
    },
    {
      label: 'New folder',
      onSelect: () => {
        setOpen(true);
        setAdding(true);
      },
    },
    { label: 'Rename', onSelect: () => setRenaming(true) },
    'separator',
    {
      label: 'Delete folder',
      danger: true,
      confirm: 'Delete folder & contents?',
      onSelect: () => actions.onDelete(relPath),
    },
  ];

  return (
    <div ref={setDropRef} className={cx('rounded-md', isOver && 'ring-1 ring-accent/50')}>
      <div
        className={cx(
          'group/row flex items-center rounded-md hover:bg-line-soft',
          isDragging && 'opacity-50',
        )}
        onContextMenu={(e) => {
          e.stopPropagation();
          openMenu(e, menu);
        }}
      >
        <button
          type="button"
          ref={setDragRef}
          {...attributes}
          {...listeners}
          onClick={() => setOpen((v) => !v)}
          onDoubleClick={(e) => {
            e.preventDefault();
            setRenaming(true);
          }}
          style={indent(depth)}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pr-1 text-[13px] text-ink-muted"
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
          <span className="truncate font-medium">{node.name}</span>
          {!open && node.hasChanges && <DeltaDot delta="change" faint />}
        </button>
        <div className="flex shrink-0 items-center pr-1 opacity-0 transition-opacity group-hover/row:opacity-100">
          <IconButton aria-label={`New entry in ${node.name}`} onClick={() => actions.onNewItem(node.path)}>
            <span className="text-[13px] leading-none">＋</span>
          </IconButton>
          <IconButton
            aria-label={`New folder in ${node.name}`}
            onClick={() => {
              setOpen(true);
              setAdding(true);
            }}
          >
            <span className="text-[12px] leading-none">🗀</span>
          </IconButton>
        </div>
      </div>

      {open && (
        <div className="space-y-0.5">
          {adding && (
            <FolderNameInput
              depth={depth + 1}
              onSubmit={(name) => {
                actions.onNewFolder(node.path, name);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          )}
          {node.folders.map((f) => (
            <Folder key={f.path} node={f} depth={depth + 1} actions={actions} />
          ))}
          {node.files.map((leaf) => (
            <FileRow key={leaf.to} leaf={leaf} depth={depth + 1} actions={actions} />
          ))}
        </div>
      )}
    </div>
  );
}

function FileRow({ leaf, depth, actions }: { leaf: FileLeaf; depth: number; actions: TreeActions }) {
  const { openMenu } = useContextMenu();
  const [renaming, setRenaming] = useState(false);
  const {
    setNodeRef,
    listeners,
    attributes,
    isDragging,
  } = useDraggable({ id: `file:${leaf.relPath}`, data: { label: leaf.title } });

  if (renaming) {
    return (
      <RenameInput
        depth={depth + 1}
        initial={leaf.title}
        onSubmit={(name) => {
          setRenaming(false);
          actions.onMove(leaf.relPath, fileRenameTarget(leaf.relPath, name));
        }}
        onCancel={() => setRenaming(false)}
      />
    );
  }

  const menu: MenuEntry[] = [
    { label: 'Rename', onSelect: () => setRenaming(true) },
    { label: 'Duplicate', onSelect: () => actions.onDuplicate(leaf.relPath) },
    'separator',
    {
      label: 'Delete',
      danger: true,
      confirm: 'Delete entry?',
      onSelect: () => actions.onDelete(leaf.relPath),
    },
  ];

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onDoubleClick={(e) => {
        e.preventDefault();
        setRenaming(true);
      }}
      onContextMenu={(e) => {
        e.stopPropagation();
        openMenu(e, menu);
      }}
      className={isDragging ? 'opacity-50' : undefined}
    >
      <NavLink
        to={leaf.to}
        title={leaf.title}
        style={indent(depth + 1)}
        className={({ isActive }) =>
          cx(
            'flex items-center gap-1.5 rounded-md py-1 pr-2 text-[13px] transition-colors',
            isActive ? 'bg-active font-medium text-ink' : 'text-ink-muted hover:bg-line-soft',
          )
        }
      >
        <span className="min-w-0 flex-1 truncate">{leaf.title}</span>
        {leaf.delta && <DeltaDot delta={leaf.delta} />}
      </NavLink>
    </div>
  );
}

function FolderNameInput({
  depth,
  onSubmit,
  onCancel,
}: {
  depth: number;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const commit = () => {
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed);
    else onCancel();
  };
  return (
    <input
      autoFocus
      value={value}
      placeholder="folder name…"
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') onCancel();
      }}
      style={indent(depth + 1)}
      className="block w-full rounded-md border border-line bg-paper py-1 pr-2 text-[13px] text-ink outline-none placeholder:text-ink-subtle"
    />
  );
}

function RenameInput({
  depth,
  initial,
  onSubmit,
  onCancel,
}: {
  depth: number;
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
      style={indent(depth + 1)}
      className="block w-full rounded-md border border-line bg-paper py-1 pr-2 text-[13px] text-ink outline-none"
    />
  );
}
