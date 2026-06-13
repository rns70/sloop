// The Databank sidebar tree. Folders are derived purely from ADR file paths
// (databank/auth/adr-007.md → folder "auth"), so there are no empty directories and no
// folder endpoint — a folder exists exactly when it holds a file. Each folder and the
// root can spawn a new ADR (instant) or a new subfolder (name-first inline input, since a
// folder's name *is* its path). Navigation/refresh is the parent's job via callbacks.

import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import type { AdrDoc } from '../api-client/index';
import { IconButton, cx } from '../design/index';

interface FileLeaf {
  title: string;
  to: string;
}
interface FolderNode {
  name: string;
  path: string; // databank-relative, e.g. "auth" or "auth/oauth"
  folders: FolderNode[];
  files: FileLeaf[];
}

const enc = encodeURIComponent;

/** Build the folder/file tree from ADR relPaths (each `databank/<...>/<file>.md`). */
function buildTree(adrs: AdrDoc[]): FolderNode {
  const root: FolderNode = { name: '', path: '', folders: [], files: [] };
  for (const adr of [...adrs].sort((a, b) => a.relPath.localeCompare(b.relPath))) {
    const sub = adr.relPath.replace(/^databank\//, '');
    const segments = sub.split('/');
    const fileName = segments.pop() ?? sub;
    let node = root;
    let acc = '';
    for (const seg of segments) {
      acc = acc ? `${acc}/${seg}` : seg;
      let next = node.folders.find((f) => f.name === seg);
      if (!next) {
        next = { name: seg, path: acc, folders: [], files: [] };
        node.folders.push(next);
      }
      node = next;
    }
    const dirPrefix = segments.length ? `${segments.map(enc).join('/')}/` : '';
    node.files.push({ title: adr.title || fileName, to: `/databank/${dirPrefix}${enc(fileName)}` });
  }
  return root;
}

export interface DatabankTreeProps {
  adrs: AdrDoc[];
  /** Create a new ADR inside `folder` ('' = root). */
  onNewItem: (folder: string) => void;
  /** Create a new subfolder named `name` under `parent` ('' = root). */
  onNewFolder: (parent: string, name: string) => void;
  /** Whether the root-level "new folder" input is open (driven by the group header). */
  rootAdding: boolean;
  onRootAddingDone: () => void;
}

export function DatabankTree({
  adrs,
  onNewItem,
  onNewFolder,
  rootAdding,
  onRootAddingDone,
}: DatabankTreeProps) {
  const root = buildTree(adrs);
  return (
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
        <Folder key={f.path} node={f} depth={0} onNewItem={onNewItem} onNewFolder={onNewFolder} />
      ))}
      {root.files.map((leaf) => (
        <FileRow key={leaf.to} leaf={leaf} depth={0} />
      ))}
      {root.folders.length === 0 && root.files.length === 0 && !rootAdding && (
        <p className="px-2 py-1 text-[12px] text-ink-subtle">No entries yet</p>
      )}
    </div>
  );
}

const indent = (depth: number) => ({ paddingLeft: `${depth * 12 + 8}px` });

function Folder({
  node,
  depth,
  onNewItem,
  onNewFolder,
}: {
  node: FolderNode;
  depth: number;
  onNewItem: (folder: string) => void;
  onNewFolder: (parent: string, name: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);

  return (
    <div>
      <div className="group/row flex items-center rounded-md hover:bg-line-soft">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
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
        </button>
        <div className="flex shrink-0 items-center pr-1 opacity-0 transition-opacity group-hover/row:opacity-100">
          <IconButton aria-label={`New entry in ${node.name}`} onClick={() => onNewItem(node.path)}>
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
                onNewFolder(node.path, name);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          )}
          {node.folders.map((f) => (
            <Folder
              key={f.path}
              node={f}
              depth={depth + 1}
              onNewItem={onNewItem}
              onNewFolder={onNewFolder}
            />
          ))}
          {node.files.map((leaf) => (
            <FileRow key={leaf.to} leaf={leaf} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function FileRow({ leaf, depth }: { leaf: FileLeaf; depth: number }) {
  return (
    <NavLink
      to={leaf.to}
      title={leaf.title}
      style={indent(depth + 1)}
      className={({ isActive }) =>
        cx(
          'block truncate rounded-md py-1 pr-2 text-[13px] transition-colors',
          isActive ? 'bg-active font-medium text-ink' : 'text-ink-muted hover:bg-line-soft',
        )
      }
    >
      {leaf.title}
    </NavLink>
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
