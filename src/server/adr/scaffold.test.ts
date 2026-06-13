import { describe, it, expect } from 'vitest';
import type { AdrDoc, WorkflowDef } from '../../shared/index';
import { ADR_BODY_TEMPLATE } from '../../shared/index';
import { planWorkflowScaffold, slugifyStep } from './scaffold';

function parent(over: Partial<AdrDoc> & { id: string; relPath: string }): AdrDoc {
  return {
    title: over.id,
    body: 'parent body',
    acceptanceCriteria: [],
    children: [],
    status: 'idle',
    outputs: [],
    ...over,
  };
}

function workflow(over: Partial<WorkflowDef> & { id: string }): WorkflowDef {
  return {
    name: over.id,
    steps: [],
    guidance: '',
    ...over,
  };
}

describe('slugifyStep', () => {
  it('lowercases, replaces non-alphanumerics with dashes, and trims', () => {
    expect(slugifyStep('Code Review')).toBe('code-review');
    expect(slugifyStep('  Plan / Design!  ')).toBe('plan-design');
  });
  it('never returns an empty slug', () => {
    expect(slugifyStep('   ')).toBe('step');
    expect(slugifyStep('!!!')).toBe('step');
  });
});

describe('planWorkflowScaffold', () => {
  const wf = workflow({
    id: 'ship-it',
    name: 'Ship It',
    steps: [
      { name: 'Plan', role: 'architect', model: 'opus' },
      { name: 'Implement', role: 'engineer', model: 'sonnet' },
    ],
  });

  it('creates one child ADR per step with correct id/relPath/role/workflow', () => {
    const p = parent({ id: 'feat', relPath: 'loops/auth/feat.md' });
    const { children, parentChildren } = planWorkflowScaffold(p, wf, new Set([p.id]));

    expect(children).toHaveLength(2);
    expect(children[0]).toMatchObject({
      id: 'feat-plan',
      relPath: 'loops/auth/feat-plan.md',
      title: 'Plan',
      role: 'architect',
      workflow: 'ship-it',
      status: 'idle',
      children: [],
      outputs: [],
      acceptanceCriteria: [],
      body: ADR_BODY_TEMPLATE,
    });
    expect(children[1]).toMatchObject({
      id: 'feat-implement',
      relPath: 'loops/auth/feat-implement.md',
      role: 'engineer',
      workflow: 'ship-it',
    });

    // Parent gains the new children as relPath links, in step order.
    expect(parentChildren).toEqual(['loops/auth/feat-plan.md', 'loops/auth/feat-implement.md']);
  });

  it('places children in the parent top-level dir when the parent has no subfolder', () => {
    const p = parent({ id: 'feat', relPath: 'loops/feat.md' });
    const { children } = planWorkflowScaffold(p, wf, new Set([p.id]));
    expect(children.map((c) => c.relPath)).toEqual(['loops/feat-plan.md', 'loops/feat-implement.md']);
  });

  it('is idempotent: skips steps whose id already exists, preserving existing children & order', () => {
    const p = parent({
      id: 'feat',
      relPath: 'loops/feat.md',
      children: ['loops/feat-plan.md', 'loops/other.md'], // already applied once + an unrelated child
    });
    const existingIds = new Set([p.id, 'feat-plan']); // feat-plan already on disk
    const { children, parentChildren } = planWorkflowScaffold(p, wf, existingIds);

    // Only the not-yet-existing step is created.
    expect(children.map((c) => c.id)).toEqual(['feat-implement']);
    // Existing children preserved (order + dedupe), new relPath appended once.
    expect(parentChildren).toEqual([
      'loops/feat-plan.md',
      'loops/other.md',
      'loops/feat-implement.md',
    ]);
  });

  it('collapses two steps that slug to the same id into a single child', () => {
    const dupe = workflow({
      id: 'dupe',
      steps: [
        { name: 'Code Review', role: 'engineer', model: 'sonnet' },
        { name: 'code-review', role: 'engineer', model: 'sonnet' }, // same slug
      ],
    });
    const p = parent({ id: 'feat', relPath: 'loops/feat.md' });
    const { children, parentChildren } = planWorkflowScaffold(p, dupe, new Set([p.id]));
    expect(children.map((c) => c.id)).toEqual(['feat-code-review']);
    expect(parentChildren).toEqual(['loops/feat-code-review.md']);
  });

  it('omits the role field when a step has no role', () => {
    const noRole = workflow({ id: 'wf', steps: [{ name: 'Do', role: '', model: 'sonnet' }] });
    const p = parent({ id: 'feat', relPath: 'loops/feat.md' });
    const { children } = planWorkflowScaffold(p, noRole, new Set([p.id]));
    expect(children[0].role).toBeUndefined();
  });
});
