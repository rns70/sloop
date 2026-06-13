import { describe, it, expect } from 'vitest';
import type { RoleDef, ModelOption } from '../../api-client/index';
import {
  makeStep,
  addStep,
  removeStep,
  moveStep,
  updateStep,
  validateSteps,
  withCurrent,
  type WorkflowStep,
} from './workflowSteps';

const roles: RoleDef[] = [
  { id: 'architect', name: 'Architect', defaultModel: 'opus', brief: '' },
  { id: 'engineer', name: 'Engineer', defaultModel: 'haiku', brief: '' },
];
const models: ModelOption[] = [
  { alias: 'opus', provider: 'anthropic', id: 'claude-opus-4-8' },
  { alias: 'haiku', provider: 'anthropic', id: 'claude-haiku-4-5-20251001' },
];

const steps: WorkflowStep[] = [
  Object.freeze({ name: 'plan', role: 'architect', model: 'opus' }),
  Object.freeze({ name: 'build', role: 'engineer', model: 'haiku', gate: true }),
] as WorkflowStep[];

describe('workflowSteps helpers', () => {
  it('makeStep defaults to the first role and its default model, not gated', () => {
    expect(makeStep(roles, models)).toEqual({ name: '', role: 'architect', model: 'opus', gate: false });
  });

  it('makeStep falls back to the first model alias when the role has no defaultModel', () => {
    const noModelRole: RoleDef[] = [{ id: 'x', name: 'X', defaultModel: '', brief: '' }];
    expect(makeStep(noModelRole, models).model).toBe('opus');
  });

  it('addStep appends a new step', () => {
    expect(addStep(steps, roles, models)).toHaveLength(3);
  });

  it('removeStep drops the step at an index', () => {
    expect(removeStep(steps, 0)).toEqual([steps[1]]);
  });

  it('moveStep(-1) swaps a step upward', () => {
    expect(moveStep(steps, 1, -1)).toEqual([steps[1], steps[0]]);
  });

  it('moveStep is a no-op at the boundary', () => {
    expect(moveStep(steps, 0, -1)).toEqual(steps);
  });

  it('moveStep(+1) swaps a step downward', () => {
    expect(moveStep(steps, 0, 1)).toEqual([steps[1], steps[0]]);
  });

  it('updateStep patches one step immutably', () => {
    const next = updateStep(steps, 0, { name: 'design' });
    expect(next[0]).toEqual({ name: 'design', role: 'architect', model: 'opus' });
    expect(steps[0].name).toBe('plan'); // original unchanged
  });

  it('validateSteps returns null for a valid list', () => {
    expect(validateSteps(steps)).toBeNull();
  });

  it('validateSteps rejects an empty list', () => {
    expect(validateSteps([])).toMatch(/at least one step/i);
  });

  it('validateSteps rejects a blank step name', () => {
    expect(validateSteps([{ name: '  ', role: 'engineer', model: 'haiku' }])).toMatch(/name/i);
  });

  it('validateSteps rejects a step with no role', () => {
    expect(validateSteps([{ name: 'a', role: '', model: 'haiku' }])).toMatch(/role/i);
  });

  it('validateSteps rejects a step with no model', () => {
    expect(validateSteps([{ name: 'a', role: 'engineer', model: '' }])).toMatch(/model/i);
  });

  it('withCurrent prepends the current value when missing', () => {
    expect(withCurrent(['a', 'b'], 'c')).toEqual(['c', 'a', 'b']);
    expect(withCurrent(['a', 'b'], 'a')).toEqual(['a', 'b']);
  });
});
