// The Cmd+K (Ctrl+K) command palette: a global quick-switcher + action launcher.
// Opens over any view, fetches the same lists the sidebar shows, fuzzy-filters them
// (see commands.ts), and runs the chosen command — jump to a file, or fire an action
// like "New databank entry" or "Save current document". Built on the design tokens so
// it reads as the same quiet surface as the rest of the app (no new dependency).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getAdrs,
  getCascades,
  getRoles,
  getWorkflows,
  type AdrDoc,
  type CascadeSummary,
  type RoleDef,
  type WorkflowDef,
} from '../api-client/index';
import { cx } from '../design/index';
import { humanizeCascade } from '../views/mission-control/text';
import { createDatabankItem, createLibraryItem } from './createItem';
import { useSaveAction } from './EditorActionsContext';
import { buildCommands, filterCommands, type CommandItem, type CommandSources } from './commands';

const EMPTY_SOURCES: CommandSources = { adrs: [], cascades: [], roles: [], workflows: [] };

/** Did this keydown ask to open the palette? Cmd+K on mac, Ctrl+K elsewhere. */
function isPaletteToggle(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'k' || e.key === 'K');
}

export function CommandPalette() {
  const navigate = useNavigate();
  const saveAction = useSaveAction();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  // Raw data; refetched each time the palette opens so freshly-created items appear.
  const [adrs, setAdrs] = useState<AdrDoc[]>([]);
  const [cascades, setCascades] = useState<CascadeSummary[]>([]);
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setActive(0);
  }, []);

  // Global toggle: Cmd/Ctrl+K opens (and closes) the palette from anywhere, including
  // while focused in the editor. We swallow the event so the browser doesn't also act.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPaletteToggle(e)) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Reset transient state and load fresh lists whenever we open. Failures degrade
  // gracefully: a list that fails to load simply contributes no commands.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    inputRef.current?.focus();

    let cancelled = false;
    getAdrs().then((v) => !cancelled && setAdrs(v)).catch(() => undefined);
    getCascades().then((v) => !cancelled && setCascades(v)).catch(() => undefined);
    getRoles().then((v) => !cancelled && setRoles(v)).catch(() => undefined);
    getWorkflows().then((v) => !cancelled && setWorkflows(v)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open]);

  const sources: CommandSources = useMemo(
    () =>
      open
        ? {
            adrs: adrs.map((a) => ({ relPath: a.relPath, title: a.title })),
            cascades: cascades.map((c) => ({ id: c.id, label: humanizeCascade(c.id) })),
            roles: roles.map((r) => ({ id: r.id, name: r.name })),
            workflows: workflows.map((t) => ({ id: t.id, name: t.name })),
          }
        : EMPTY_SOURCES,
    [open, adrs, cascades, roles, workflows],
  );

  const commands = useMemo(
    () =>
      buildCommands(sources, {
        navigate,
        newAdr: () =>
          void createDatabankItem(adrs.map((a) => a.relPath), '')
            .then((sub) => navigate(`/databank/${sub}?new=1`))
            .catch(() => undefined),
        newRole: () =>
          void createLibraryItem('roles', roles.map((r) => r.id))
            .then((id) => navigate(`/libraries/roles/${id}?new=1`))
            .catch(() => undefined),
        newWorkflow: () =>
          void createLibraryItem('workflows', workflows.map((t) => t.id))
            .then((id) => navigate(`/libraries/workflows/${id}?new=1`))
            .catch(() => undefined),
        saveDoc: saveAction,
      }),
    [sources, navigate, adrs, roles, workflows, saveAction],
  );

  const results = useMemo(() => filterCommands(commands, query), [commands, query]);

  // Keep the active index in range as the filtered list shrinks/grows.
  useEffect(() => {
    setActive((i) => (results.length === 0 ? 0 : Math.min(i, results.length - 1)));
  }, [results.length]);

  const choose = useCallback(
    (item: CommandItem | undefined) => {
      if (!item || item.disabled) return;
      close();
      item.run();
    },
    [close],
  );

  // Arrow / Enter / Escape navigation while the input holds focus.
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (results.length === 0 ? 0 : (i + 1) % results.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    }
  };

  // Scroll the active row into view as the selection moves by keyboard.
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/20 px-4 pt-[12vh]"
      onMouseDown={close}
      role="presentation"
    >
      <div
        className="flex max-h-[64vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-line bg-paper shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onInputKeyDown}
          placeholder="Search files and commands…"
          className="w-full border-b border-line-hair bg-transparent px-4 py-3 text-[14px] text-ink outline-none placeholder:text-ink-subtle"
          aria-label="Search files and commands"
          autoComplete="off"
          spellCheck={false}
        />

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-ink-subtle">No matches</p>
          ) : (
            <CommandRows results={results} active={active} onHover={setActive} onChoose={choose} />
          )}
        </div>
      </div>
    </div>
  );
}

/** Renders results with a quiet group heading whenever the group changes. */
function CommandRows({
  results,
  active,
  onHover,
  onChoose,
}: {
  results: CommandItem[];
  active: number;
  onHover: (i: number) => void;
  onChoose: (item: CommandItem) => void;
}) {
  let lastGroup: string | null = null;
  return (
    <>
      {results.map((item, i) => {
        const showHeading = item.group !== lastGroup;
        lastGroup = item.group;
        return (
          <div key={item.id}>
            {showHeading && (
              <div className="px-4 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
                {item.group}
              </div>
            )}
            <button
              type="button"
              data-index={i}
              disabled={item.disabled}
              onMouseMove={() => onHover(i)}
              onClick={() => onChoose(item)}
              className={cx(
                'flex w-full items-baseline gap-2 px-4 py-1.5 text-left text-[13.5px] transition-colors',
                i === active ? 'bg-active' : 'bg-transparent',
                item.disabled ? 'cursor-not-allowed text-ink-subtle' : 'text-ink',
              )}
            >
              <span className="truncate">{item.title}</span>
              {item.hint && (
                <span className="ml-auto truncate font-mono text-[11px] text-ink-faint">
                  {item.hint}
                </span>
              )}
            </button>
          </div>
        );
      })}
    </>
  );
}
