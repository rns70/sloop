// Structured editor for a workflow's ordered steps. Controlled: the parent owns the
// steps array and re-renders on change. All mutation goes through the pure helpers
// in ./workflowSteps so this file stays declarative.

import type { RoleDef, ModelOption } from '../../api-client/index';
import { IconButton } from '../../design/index';
import {
  addStep,
  removeStep,
  moveStep,
  updateStep,
  withCurrent,
  type WorkflowStep,
} from './workflowSteps';

export interface WorkflowStepsEditorProps {
  steps: WorkflowStep[];
  roles: RoleDef[];
  models: ModelOption[];
  onChange: (steps: WorkflowStep[]) => void;
}

const FIELD_CLASS =
  'rounded-md border border-line bg-white px-2 py-1 text-[13px] text-ink-muted ' +
  'focus:border-accent focus:outline-none disabled:opacity-50';

export function WorkflowStepsEditor({ steps, roles, models, onChange }: WorkflowStepsEditorProps) {
  const roleOptions = (current: string) =>
    withCurrent(roles.map((r) => r.id), current);
  const modelOptions = (current: string) =>
    withCurrent(models.map((m) => m.alias), current);

  return (
    <div className="mb-5">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-ink-faint">
        Steps
      </div>
      <div className="flex flex-col gap-2">
        {steps.map((step, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-line p-2">
            <input
              className={`${FIELD_CLASS} flex-1 min-w-[8rem]`}
              value={step.name}
              placeholder="step name"
              onChange={(e) => onChange(updateStep(steps, i, { name: e.target.value }))}
            />
            <select
              className={FIELD_CLASS}
              value={step.role}
              onChange={(e) => onChange(updateStep(steps, i, { role: e.target.value }))}
            >
              {roleOptions(step.role).map((id) => (
                <option key={id} value={id}>{id}</option>
              ))}
            </select>
            <select
              className={FIELD_CLASS}
              value={step.model}
              onChange={(e) => onChange(updateStep(steps, i, { model: e.target.value }))}
            >
              {modelOptions(step.model).map((alias) => (
                <option key={alias} value={alias}>{alias}</option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-[12px] text-ink-faint">
              <input
                type="checkbox"
                checked={Boolean(step.gate)}
                onChange={(e) => onChange(updateStep(steps, i, { gate: e.target.checked }))}
              />
              gate
            </label>
            <IconButton aria-label="Move step up" disabled={i === 0} onClick={() => onChange(moveStep(steps, i, -1))}>
              ↑
            </IconButton>
            <IconButton
              aria-label="Move step down"
              disabled={i === steps.length - 1}
              onClick={() => onChange(moveStep(steps, i, 1))}
            >
              ↓
            </IconButton>
            <IconButton aria-label="Remove step" onClick={() => onChange(removeStep(steps, i))}>
              ✕
            </IconButton>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="mt-2 text-[13px] text-accent hover:underline"
        onClick={() => onChange(addStep(steps, roles, models))}
      >
        + Add step
      </button>
    </div>
  );
}
