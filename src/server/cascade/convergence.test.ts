import { describe, it, expect } from 'vitest';
import type { AcceptanceCriterion, LoopDoc, LoopFrontmatter, LoopStatus } from '../../shared/index';
import { indexById, isLoopDone, recompute, rootStatus } from './convergence';

/** Compact loop factory for hand-built trees. */
function loop(
  id: string,
  status: LoopStatus,
  opts: {
    kind?: LoopFrontmatter['kind'];
    parent?: string;
    children?: string[];
    criteria?: Array<Partial<AcceptanceCriterion>>;
  } = {},
): LoopDoc {
  return {
    relPath: `cascades/c/${id}.md`,
    body: '',
    frontmatter: {
      id,
      kind: opts.kind ?? (opts.children?.length ? 'inner' : 'leaf'),
      role: 'engineer',
      model: 'haiku',
      status,
      children: opts.children ?? [],
      parent: opts.parent,
      acceptanceCriteria: (opts.criteria ?? []).map((c, i) => ({
        id: c.id ?? `ac-${i + 1}`,
        text: c.text ?? 'criterion',
        verify: c.verify,
        passed: c.passed ?? false,
      })),
    },
  };
}

/** Status of a loop by id after a recompute. */
function statusOf(loops: LoopDoc[], id: string): LoopStatus {
  const found = loops.find((l) => l.frontmatter.id === id);
  if (!found) throw new Error(`no loop ${id}`);
  return found.frontmatter.status;
}

describe('isLoopDone', () => {
  it('is true only when every child is done and own criteria pass', () => {
    const child = loop('leaf', 'done', { criteria: [{ passed: true }] });
    const root = loop('root', 'executing', {
      kind: 'architect',
      children: ['leaf'],
    });
    const byId = indexById([root, child]);
    expect(isLoopDone(root, byId)).toBe(true);
  });

  it('is false when a child is not done', () => {
    const child = loop('leaf', 'executing', { criteria: [{ passed: false }] });
    const root = loop('root', 'executing', { kind: 'architect', children: ['leaf'] });
    expect(isLoopDone(root, indexById([root, child]))).toBe(false);
  });

  it('is false when own criteria have not passed even if children are done', () => {
    const child = loop('leaf', 'done', { criteria: [{ passed: true }] });
    const root = loop('root', 'executing', {
      kind: 'inner',
      children: ['leaf'],
      criteria: [{ passed: false }],
    });
    expect(isLoopDone(root, indexById([root, child]))).toBe(false);
  });

  it('treats a leaf with all criteria passed as done', () => {
    const leaf = loop('leaf', 'review', { criteria: [{ passed: true }, { passed: true }] });
    expect(isLoopDone(leaf, indexById([leaf]))).toBe(true);
  });
});

describe('recompute — the convergence invariant', () => {
  it('bubbles all-pass leaves up to a done root', () => {
    const a = loop('l1', 'review', { parent: '_architect', criteria: [{ passed: true }] });
    const b = loop('l2', 'review', { parent: '_architect', criteria: [{ passed: true }] });
    const root = loop('_architect', 'executing', {
      kind: 'architect',
      children: ['l1', 'l2'],
    });
    const out = recompute([root, a, b]);
    expect(statusOf(out, 'l1')).toBe('done');
    expect(statusOf(out, 'l2')).toBe('done');
    expect(statusOf(out, '_architect')).toBe('done');
    expect(rootStatus(out)).toBe('done');
  });

  it('blocks the root when any descendant fails', () => {
    const ok = loop('l1', 'review', { parent: '_architect', criteria: [{ passed: true }] });
    const bad = loop('l2', 'failed', { parent: '_architect', criteria: [{ passed: false }] });
    const root = loop('_architect', 'executing', {
      kind: 'architect',
      children: ['l1', 'l2'],
    });
    const out = recompute([root, ok, bad]);
    expect(statusOf(out, 'l1')).toBe('done');
    expect(statusOf(out, 'l2')).toBe('failed');
    expect(statusOf(out, '_architect')).toBe('blocked');
  });

  it('propagates a blocked grandchild through an inner loop to the root', () => {
    const grandchild = loop('g', 'failed', { parent: 'inner', criteria: [{ passed: false }] });
    const inner = loop('inner', 'executing', {
      kind: 'inner',
      parent: '_architect',
      children: ['g'],
    });
    const root = loop('_architect', 'executing', {
      kind: 'architect',
      children: ['inner'],
    });
    const out = recompute([root, inner, grandchild]);
    expect(statusOf(out, 'inner')).toBe('blocked');
    expect(statusOf(out, '_architect')).toBe('blocked');
  });

  it('reports executing while some leaves are still running', () => {
    const done = loop('l1', 'review', { parent: '_architect', criteria: [{ passed: true }] });
    const running = loop('l2', 'executing', { parent: '_architect', criteria: [{ passed: false }] });
    const root = loop('_architect', 'queued', { kind: 'architect', children: ['l1', 'l2'] });
    const out = recompute([root, done, running]);
    expect(statusOf(out, '_architect')).toBe('executing');
  });

  it('keeps a fully-pending tree at its pre-approval status', () => {
    const l1 = loop('l1', 'planned', { parent: '_architect', criteria: [{ passed: false }] });
    const l2 = loop('l2', 'planned', { parent: '_architect', criteria: [{ passed: false }] });
    const root = loop('_architect', 'awaiting_approval', {
      kind: 'architect',
      children: ['l1', 'l2'],
    });
    const out = recompute([root, l1, l2]);
    expect(statusOf(out, '_architect')).toBe('awaiting_approval');
  });

  it('does not mutate the input loops', () => {
    const leaf = loop('l1', 'review', { parent: '_architect', criteria: [{ passed: true }] });
    const root = loop('_architect', 'executing', { kind: 'architect', children: ['l1'] });
    const input = [root, leaf];
    const snapshot = JSON.parse(JSON.stringify(input));
    recompute(input);
    expect(input).toEqual(snapshot);
  });

  it('downgrades a stale done leaf whose criteria regressed', () => {
    const leaf = loop('l1', 'done', { criteria: [{ passed: false }] });
    const out = recompute([leaf]);
    expect(statusOf(out, 'l1')).not.toBe('done');
  });
});
