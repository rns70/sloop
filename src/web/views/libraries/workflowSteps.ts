// Pure, immutable helpers for editing a workflow's ordered steps. Kept out of the
// React component so the mutation logic is unit-testable without a DOM (the web
// suite runs in node). The component renders these results; it owns no step logic.

import type { RoleDef, ModelOption, WorkflowDef } from '../../api-client/index';

export type WorkflowStep = WorkflowDef['steps'][number];

/** A fresh, blank-named step defaulting to the first role and that role's default model. */
export function makeStep(roles: RoleDef[], models: ModelOption[]): WorkflowStep {
  const role = roles[0]?.id ?? '';
  const model = roles[0]?.defaultModel || models[0]?.alias || '';
  return { name: '', role, model, gate: false };
}

export function addStep(steps: WorkflowStep[], roles: RoleDef[], models: ModelOption[]): WorkflowStep[] {
  return [...steps, makeStep(roles, models)];
}

export function removeStep(steps: WorkflowStep[], index: number): WorkflowStep[] {
  return steps.filter((_, i) => i !== index);
}

/** Move the step at `index` by `dir` (-1 up, +1 down). No-op at the boundaries. */
export function moveStep(steps: WorkflowStep[], index: number, dir: -1 | 1): WorkflowStep[] {
  const target = index + dir;
  if (target < 0 || target >= steps.length) return steps;
  const next = [...steps];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function updateStep(steps: WorkflowStep[], index: number, patch: Partial<WorkflowStep>): WorkflowStep[] {
  return steps.map((s, i) => (i === index ? { ...s, ...patch } : s));
}

/** Returns a human-readable error, or null when the steps are saveable. */
export function validateSteps(steps: WorkflowStep[]): string | null {
  if (steps.length === 0) return 'A workflow needs at least one step.';
  for (const s of steps) {
    if (!s.name.trim()) return 'Every step needs a name.';
    if (!s.role) return 'Every step needs a role.';
    if (!s.model) return 'Every step needs a model.';
  }
  return null;
}

/** Ensure `current` is selectable even if the option list dropped it. */
export function withCurrent(options: string[], current: string): string[] {
  return options.includes(current) ? options : [current, ...options];
}
