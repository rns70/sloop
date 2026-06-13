import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../../server/files/frontmatter';
import type { WorkflowDef } from '../api-client/index';
import { serializeWorkflow } from './createItem';

describe('serializeWorkflow round-trip', () => {
  const steps: WorkflowDef['steps'] = [
    { name: 'plan', role: 'architect', model: 'opus' },
    { name: 'implement', role: 'engineer', model: 'haiku' },
    { name: 'verify', role: 'qa', model: 'sonnet', gate: true },
  ];

  it('persists gate and preserves step order', () => {
    const raw = serializeWorkflow({ id: 'spec-driven', name: 'Spec-driven', steps }, 'Guidance body.');
    const { data } = parseFrontmatter<Partial<WorkflowDef>>(raw);
    expect(data.steps).toEqual(steps);
  });

  it('omits the gate key when a step is not gated', () => {
    const raw = serializeWorkflow(
      { id: 'w', name: 'W', steps: [{ name: 'a', role: 'engineer', model: 'haiku' }] },
      'body',
    );
    expect(raw).not.toContain('gate');
  });

  it('keeps boolean-like step names as strings', () => {
    const raw = serializeWorkflow(
      { id: 'w', name: 'W', steps: [{ name: 'true', role: 'engineer', model: 'haiku' }] },
      'body',
    );
    const { data } = parseFrontmatter<Partial<WorkflowDef>>(raw);
    expect(data.steps?.[0].name).toBe('true');
    expect(typeof data.steps?.[0].name).toBe('string');
  });

  it('keeps numeric-like step names as strings', () => {
    const raw = serializeWorkflow(
      { id: 'w', name: 'W', steps: [{ name: '123', role: 'engineer', model: 'haiku' }] },
      'body',
    );
    const { data } = parseFrontmatter<Partial<WorkflowDef>>(raw);
    expect(data.steps?.[0].name).toBe('123');
    expect(typeof data.steps?.[0].name).toBe('string');
  });
});
