import { describe, expect, it, vi } from 'vitest';
import {
  adrRoute,
  buildCommands,
  filterCommands,
  fuzzyScore,
  type CommandSources,
} from './commands';

const sources: CommandSources = {
  adrs: [
    { relPath: 'databank/auth/login.md', title: 'Login flow' },
    { relPath: 'databank/billing/invoices.md', title: 'Invoices' },
  ],
  cascades: [{ id: 'run-1', label: 'Run 1' }],
  roles: [{ id: 'engineer', name: 'Engineer' }],
  templates: [{ id: 'feature', name: 'Feature' }],
};

const handlers = () => ({
  navigate: vi.fn(),
  newAdr: vi.fn(),
  newRole: vi.fn(),
  newTemplate: vi.fn(),
  saveDoc: null,
});

describe('adrRoute', () => {
  it('strips the databank prefix and encodes only the filename', () => {
    expect(adrRoute('databank/auth/login.md')).toBe('/databank/auth/login.md');
    expect(adrRoute('databank/adr 7.md')).toBe('/databank/adr%207.md');
    expect(adrRoute('databank/a/b/c.md')).toBe('/databank/a/b/c.md');
  });
});

describe('buildCommands', () => {
  it('produces actions first, then a command per navigable surface', () => {
    const cmds = buildCommands(sources, handlers());
    const ids = cmds.map((c) => c.id);
    expect(ids.slice(0, 3)).toEqual([
      'action:new-adr',
      'action:new-role',
      'action:new-template',
    ]);
    expect(ids).toContain('nav:adr:databank/auth/login.md');
    expect(ids).toContain('nav:cascade:run-1');
    expect(ids).toContain('nav:role:engineer');
    expect(ids).toContain('nav:template:feature');
  });

  it('navigates to the matching route when a nav command runs', () => {
    const h = handlers();
    const cmds = buildCommands(sources, h);
    cmds.find((c) => c.id === 'nav:adr:databank/auth/login.md')!.run();
    expect(h.navigate).toHaveBeenCalledWith('/databank/auth/login.md');
    cmds.find((c) => c.id === 'nav:role:engineer')!.run();
    expect(h.navigate).toHaveBeenCalledWith('/libraries/roles/engineer');
  });

  it('omits Save when no document is open', () => {
    const cmds = buildCommands(sources, { ...handlers(), saveDoc: null });
    expect(cmds.find((c) => c.id === 'action:save')).toBeUndefined();
  });

  it('includes Save, disabled when the doc is clean', () => {
    const save = vi.fn();
    const clean = buildCommands(sources, { ...handlers(), saveDoc: { canSave: false, save } });
    expect(clean.find((c) => c.id === 'action:save')?.disabled).toBe(true);

    const dirty = buildCommands(sources, { ...handlers(), saveDoc: { canSave: true, save } });
    const saveCmd = dirty.find((c) => c.id === 'action:save')!;
    expect(saveCmd.disabled).toBe(false);
    saveCmd.run();
    expect(save).toHaveBeenCalledOnce();
  });
});

describe('fuzzyScore', () => {
  it('returns null when chars are absent or out of order', () => {
    expect(fuzzyScore('login', 'xyz')).toBeNull();
    expect(fuzzyScore('login', 'nigol')).toBeNull();
  });

  it('matches an in-order subsequence', () => {
    expect(fuzzyScore('login flow', 'lf')).not.toBeNull();
    expect(fuzzyScore('login', 'lgn')).not.toBeNull();
  });

  it('scores an empty query as a neutral match', () => {
    expect(fuzzyScore('anything', '')).toBe(0);
  });

  it('ranks a start-of-string match above a mid-string one', () => {
    const start = fuzzyScore('auth login', 'auth')!;
    const mid = fuzzyScore('cl auth helper', 'auth')!;
    expect(start).toBeGreaterThan(mid);
  });

  it('rewards a word-boundary match over a buried one', () => {
    const boundary = fuzzyScore('new template', 'temp')!;
    const buried = fuzzyScore('attempt', 'temp')!;
    expect(boundary).toBeGreaterThan(buried);
  });
});

describe('filterCommands', () => {
  const cmds = buildCommands(sources, handlers());

  it('returns everything, in build order, for an empty query', () => {
    expect(filterCommands(cmds, '')).toEqual(cmds);
    expect(filterCommands(cmds, '   ')).toEqual(cmds);
  });

  it('keeps only matching commands', () => {
    const res = filterCommands(cmds, 'invoic');
    expect(res.map((c) => c.id)).toContain('nav:adr:databank/billing/invoices.md');
    expect(res.every((c) => c.title.toLowerCase().includes('invoic') || c.hint?.includes('invoic'))).toBe(
      true,
    );
  });

  it('ranks a title hit above a keyword-only hit', () => {
    // "create" only appears in the action keywords, never a title.
    const res = filterCommands(cmds, 'new');
    // The three "New …" titles should all come before any keyword-only matches.
    expect(res[0].title.startsWith('New')).toBe(true);
  });

  it('matches against the hint (file path), not just the title', () => {
    const res = filterCommands(cmds, 'auth');
    expect(res.map((c) => c.id)).toContain('nav:adr:databank/auth/login.md');
  });
});
