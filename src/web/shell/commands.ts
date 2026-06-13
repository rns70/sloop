// Pure core for the Cmd+K command palette: turning the app's navigable surfaces
// (ADRs, cascades, roles, workflows) and global actions into a flat, searchable
// command list, plus the fuzzy matcher that ranks them against a query. Kept free
// of React/DOM so it can be unit-tested in the node test env (commands.test.ts);
// the CommandPalette component owns all rendering, focus and data-fetching.

/** A single selectable row in the palette. `run` performs the effect (navigate or act). */
export interface CommandItem {
  /** Stable identity for React keys and active-row tracking. */
  id: string;
  /** Primary, matched-against label. */
  title: string;
  /** Section heading this command is grouped under in the list. */
  group: string;
  /** Secondary muted text (e.g. a file path); also searched, at lower weight. */
  hint?: string;
  /** Extra search terms that never render (e.g. "create new"); searched at low weight. */
  keywords?: string;
  /** When true the row renders muted and selecting it is a no-op (e.g. Save when clean). */
  disabled?: boolean;
  /** Effect to run when the row is chosen. */
  run: () => void;
}

/** The navigable data the palette draws on — the same lists the sidebar fetches. */
export interface CommandSources {
  adrs: { relPath: string; title: string }[];
  cascades: { id: string; label: string }[];
  roles: { id: string; name: string }[];
  workflows: { id: string; name: string }[];
}

/** Effect handlers injected by the component so this module stays pure/testable. */
export interface CommandHandlers {
  navigate: (to: string) => void;
  newAdr: () => void;
  newRole: () => void;
  newTemplate: () => void;
  /** The active editor's save, if any. `null` when no document is open. */
  saveDoc: { canSave: boolean; save: () => void } | null;
}

const enc = encodeURIComponent;

/**
 * Route for an ADR given its `databank/<...>/<file>.md` relPath. Mirrors DatabankTree
 * exactly (strip the `databank/` prefix, encode only the filename segment) so palette
 * links resolve to the same URLs the sidebar produces — one source of truth for the shape.
 */
export function adrRoute(relPath: string): string {
  const sub = relPath.replace(/^databank\//, '');
  const parts = sub.split('/');
  const fileName = parts.pop() ?? '';
  const dir = parts.length ? `${parts.join('/')}/` : '';
  return `/databank/${dir}${enc(fileName)}`;
}

/** Flatten every navigable surface + the global actions into one command list. */
export function buildCommands(sources: CommandSources, handlers: CommandHandlers): CommandItem[] {
  const items: CommandItem[] = [];

  // --- Actions (listed first; short, high-intent verbs) ---
  items.push(
    {
      id: 'action:new-adr',
      title: 'New databank entry',
      group: 'Actions',
      keywords: 'create add adr requirement',
      run: handlers.newAdr,
    },
    {
      id: 'action:new-role',
      title: 'New role',
      group: 'Actions',
      keywords: 'create add library',
      run: handlers.newRole,
    },
    {
      id: 'action:new-workflow',
      title: 'New workflow',
      group: 'Actions',
      keywords: 'create add library',
      run: handlers.newTemplate,
    },
  );
  if (handlers.saveDoc) {
    const { canSave, save } = handlers.saveDoc;
    items.push({
      id: 'action:save',
      title: 'Save current document',
      group: 'Actions',
      keywords: 'write persist',
      disabled: !canSave,
      run: save,
    });
  }

  // --- Navigation (jump straight to any file or run) ---
  for (const adr of sources.adrs) {
    const sub = adr.relPath.replace(/^databank\//, '');
    items.push({
      id: `nav:adr:${adr.relPath}`,
      title: adr.title || sub,
      group: 'Databank',
      hint: sub,
      run: () => handlers.navigate(adrRoute(adr.relPath)),
    });
  }
  for (const c of sources.cascades) {
    items.push({
      id: `nav:cascade:${c.id}`,
      title: c.label,
      group: 'Cascades',
      run: () => handlers.navigate(`/cascades/${enc(c.id)}`),
    });
  }
  for (const r of sources.roles) {
    items.push({
      id: `nav:role:${r.id}`,
      title: r.name,
      group: 'Roles',
      keywords: r.id,
      run: () => handlers.navigate(`/libraries/roles/${enc(r.id)}`),
    });
  }
  for (const t of sources.workflows) {
    items.push({
      id: `nav:workflow:${t.id}`,
      title: t.name,
      group: 'Templates',
      keywords: t.id,
      run: () => handlers.navigate(`/libraries/workflows/${enc(t.id)}`),
    });
  }

  return items;
}

/**
 * Subsequence fuzzy score: every char of `query` must appear in `text` in order, else
 * `null` (no match). Higher is better. Rewards matches at the start and on word
 * boundaries (after a space, slash, dash or case bump) and contiguous runs, so
 * "auth" ranks `auth/login.md` above `cl-auth-h.md`. Case-insensitive.
 */
export function fuzzyScore(text: string, query: string): number | null {
  if (query === '') return 0;
  const t = text.toLowerCase();
  const q = query.toLowerCase();

  let score = 0;
  let ti = 0;
  let prevMatch = -2; // index of the previous matched char (for contiguity)
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;

    let bonus = 1;
    if (found === 0) {
      bonus += 8; // very start of the string
    } else {
      const before = text[found - 1];
      const boundary =
        before === ' ' || before === '/' || before === '-' || before === '_' || before === '.';
      const caseBump = before === before.toLowerCase() && text[found] !== text[found].toLowerCase();
      if (boundary || caseBump) bonus += 4; // word boundary
    }
    if (found === prevMatch + 1) bonus += 3; // contiguous with previous match
    score += bonus;

    prevMatch = found;
    ti = found + 1;
  }
  return score;
}

/**
 * Filter + rank commands against a query. Matches the title first; falls back to
 * hint/keywords at a penalty so a title hit always outranks an incidental one.
 * Empty query returns the list unchanged (preserving the curated build order).
 * Stable: equal scores keep their original order. Disabled items are kept (rendered
 * muted) so users still see why an action is unavailable.
 */
export function filterCommands(items: CommandItem[], query: string): CommandItem[] {
  const trimmed = query.trim();
  if (trimmed === '') return items;

  const scored: { item: CommandItem; score: number; order: number }[] = [];
  items.forEach((item, order) => {
    const titleScore = fuzzyScore(item.title, trimmed);
    if (titleScore !== null) {
      scored.push({ item, score: titleScore + 100, order }); // title hits float above
      return;
    }
    const secondary = [item.hint, item.keywords].filter(Boolean).join(' ');
    const secondaryScore = secondary ? fuzzyScore(secondary, trimmed) : null;
    if (secondaryScore !== null) scored.push({ item, score: secondaryScore, order });
  });

  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map((s) => s.item);
}
