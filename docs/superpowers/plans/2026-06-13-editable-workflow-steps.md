# Editable Workflow Steps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a workflow's full structural definition (its ordered steps: `name → role → model`, plus `gate`) editable in the app and round-tripped to `.sloop/workflows/<id>.md`, and fix the bug where saving a workflow drops the `gate` flag.

**Architecture:** Pure step-mutation helpers (unit-tested, node env) drive a presentational `WorkflowStepsEditor` component rendered inside the existing `LibraryFile` workflow editor. Persistence stays on the established client-serialize → `putFile` → `PUT /api/files/:relPath` path; the shared `serializeWorkflow` is fixed to emit `gate`, making it the single source of truth for workflow YAML.

**Tech Stack:** TypeScript (ESM, Node 20+), React/Vite (web), Vitest (`vitest run`, env `node`), gray-matter (via `parseFrontmatter`).

---

## Pre-flight: record the red baseline

The working tree is mid-refactor (templates→workflows) and the build is currently red. Record which failures are pre-existing so new ones introduced by this plan are distinguishable.

- [ ] **Step 0: Snapshot the baseline**

Run: `npm run typecheck 2>&1 | tail -30; npx vitest run 2>&1 | tail -20`
Save the list of failing files. These pre-existing failures are NOT yours to fix. Throughout this plan, verify your work with **targeted** `npx vitest run <file>` commands (not the whole suite), and judge only the files this plan touches.

---

## Reference: exact current code

**`src/web/shell/createItem.ts:47-59` — the function to fix (currently drops `gate`):**

```ts
/** Full workflow file content (frontmatter + guidance body). */
export function serializeWorkflow(meta: Omit<WorkflowDef, 'guidance'>, body: string): string {
  const lines = ['---', `id: ${meta.id}`, `name: ${yamlScalar(meta.name)}`, 'steps:'];
  for (const s of meta.steps) {
    lines.push(
      `  - name: ${yamlScalar(s.name)}`,
      `    role: ${yamlScalar(s.role)}`,
      `    model: ${yamlScalar(s.model)}`,
    );
  }
  lines.push('---', '', body.replace(/^\n+/, ''), '');
  return lines.join('\n');
}
```

**Types (`src/shared/types.ts`):**

```ts
export interface WorkflowDef {
  id: string;
  name: string;
  steps: { name: string; role: string; model: string; gate?: boolean }[];
  guidance: string;
}
export interface RoleDef { id: string; name: string; defaultModel: string; brief: string; color?: string; }
export interface ModelOption { alias: string; provider: ProviderName; id: string; available?: boolean; }
```

**`parseFrontmatter` (`src/server/files/frontmatter.ts:15`):** `parseFrontmatter<T>(raw: string): { data: T; body: string }`.

**Re-exports available from `../../api-client/index`:** `getRoles`, `getWorkflows`, `getModels`, `putFile`, and types `RoleDef`, `WorkflowDef`, `ModelOption`.

**Design primitives (`../../design/index`):** `Button`, `IconButton`, `PropertyRow`, `MarkdownEditor`, `EditableTitle`, `Page`, `Tag`, `roleTone`.

---

## Task 1: Fix `serializeWorkflow` to persist `gate`

**Files:**
- Create: `src/web/shell/createItem.test.ts`
- Modify: `src/web/shell/createItem.ts:47-59`

- [ ] **Step 1: Write the failing test**

Create `src/web/shell/createItem.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/web/shell/createItem.test.ts`
Expected: FAIL — the first test's `data.steps` lacks `gate: true` on the `verify` step.

- [ ] **Step 3: Fix `serializeWorkflow`**

In `src/web/shell/createItem.ts`, replace the `for (const s of meta.steps)` loop body so a gated step emits `gate: true` (and only then):

```ts
  for (const s of meta.steps) {
    lines.push(
      `  - name: ${yamlScalar(s.name)}`,
      `    role: ${yamlScalar(s.role)}`,
      `    model: ${yamlScalar(s.model)}`,
    );
    if (s.gate) lines.push('    gate: true');
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/web/shell/createItem.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/web/shell/createItem.ts src/web/shell/createItem.test.ts
git commit -m "fix(web): persist step gate when serializing workflows"
```

---

## Task 2: Pure step-editing helpers

**Files:**
- Create: `src/web/views/libraries/workflowSteps.ts`
- Test: `src/web/views/libraries/workflowSteps.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/web/views/libraries/workflowSteps.test.ts`:

```ts
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
  { name: 'plan', role: 'architect', model: 'opus' },
  { name: 'build', role: 'engineer', model: 'haiku', gate: true },
];

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

  it('withCurrent prepends the current value when missing', () => {
    expect(withCurrent(['a', 'b'], 'c')).toEqual(['c', 'a', 'b']);
    expect(withCurrent(['a', 'b'], 'a')).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/web/views/libraries/workflowSteps.test.ts`
Expected: FAIL — `Cannot find module './workflowSteps'`.

- [ ] **Step 3: Write the implementation**

Create `src/web/views/libraries/workflowSteps.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/web/views/libraries/workflowSteps.test.ts`
Expected: PASS (all helper tests green).

- [ ] **Step 5: Commit**

```bash
git add src/web/views/libraries/workflowSteps.ts src/web/views/libraries/workflowSteps.test.ts
git commit -m "feat(web): pure step-editing helpers for workflows"
```

---

## Task 3: `WorkflowStepsEditor` component

**Files:**
- Create: `src/web/views/libraries/WorkflowStepsEditor.tsx`

(No unit test — this is a presentational component with no logic of its own; all behavior lives in the Task 2 helpers, which are tested. This matches the codebase, where components such as `LoopEditor` have no tests.)

- [ ] **Step 1: Write the component**

Create `src/web/views/libraries/WorkflowStepsEditor.tsx`:

```tsx
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
```

- [ ] **Step 2: Typecheck the new file**

Run: `npx tsc -p tsconfig.json --noEmit 2>&1 | grep -E "WorkflowStepsEditor|workflowSteps" || echo "no new errors in these files"`
Expected: `no new errors in these files` (ignore unrelated pre-existing errors from the baseline). If `IconButton` does not accept `children`/`aria-label`/`disabled`/`onClick`, open `src/web/design/Button.tsx`, check `IconButtonProps`, and adjust the props to match (e.g. pass the glyph via the prop it expects).

- [ ] **Step 3: Commit**

```bash
git add src/web/views/libraries/WorkflowStepsEditor.tsx
git commit -m "feat(web): WorkflowStepsEditor component"
```

---

## Task 4: Wire the editor into `LibraryFile`

**Files:**
- Modify: `src/web/views/libraries/LibraryFile.tsx`

- [ ] **Step 1: Add imports**

At the top of `src/web/views/libraries/LibraryFile.tsx`, extend the `api-client` import to include `getModels` and `ModelOption`, and import the editor + helpers + step type:

```tsx
import {
  getModels,
  getRoles,
  getWorkflows,
  putFile,
  type ModelOption,
  type RoleDef,
  type WorkflowDef,
} from '../../api-client/index';
import { WorkflowStepsEditor } from './WorkflowStepsEditor';
import { validateSteps, type WorkflowStep } from './workflowSteps';
```

- [ ] **Step 2: Add steps/roles/models state**

Inside `LibraryEditor`, after the existing `useState` declarations, add:

```tsx
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
```

- [ ] **Step 3: Seed steps on load and fetch roles/models**

In the workflow branch of the load `useEffect` (the `getWorkflows().then(...)` callback), after `setOriginal(def.guidance);` add:

```tsx
          setSteps(def.steps);
```

Then add a second `useEffect` (after the existing load effect) that fetches the dropdown sources once, for workflows only:

```tsx
  useEffect(() => {
    if (isRole) return;
    let cancelled = false;
    getRoles().then((r) => !cancelled && setRoles(r)).catch(() => undefined);
    getModels().then((m) => !cancelled && setModels(m)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [isRole]);
```

- [ ] **Step 4: Include steps in the dirty check and validation**

Replace the existing `dirty` line:

```tsx
  const dirty = def !== null && (content !== original || name !== originalName);
```

with one that also tracks steps, plus a validation error for workflows:

```tsx
  const stepsDirty = workflow !== null && JSON.stringify(steps) !== JSON.stringify(workflow.steps);
  const dirty = def !== null && (content !== original || name !== originalName || stepsDirty);
  const stepsError = workflow !== null ? validateSteps(steps) : null;
```

- [ ] **Step 5: Pass edited steps into the serializer and block invalid saves**

In `save()`, change the workflow serialization call to use the edited `steps` instead of `workflow.steps`:

```tsx
    const fileContent = role
      ? serializeRole({ id: role.id, name, defaultModel: role.defaultModel, color: role.color }, content)
      : serializeWorkflow({ id: (workflow as WorkflowDef).id, name, steps }, content);
```

And at the very top of `save()`, before `setSaving(true)`, guard on validation:

```tsx
    if (stepsError) {
      setNote(stepsError);
      return;
    }
```

- [ ] **Step 6: Render the editor and reflect validation in the Save button**

Replace the read-only steps line in the workflow branch:

```tsx
          ) : workflow ? (
            <div className="mb-5 mt-1 text-[13px] text-ink-faint">
              {workflow.steps.map((s) => s.name).join(' → ')}
            </div>
          ) : null}
```

with the structured editor:

```tsx
          ) : workflow ? (
            <WorkflowStepsEditor steps={steps} roles={roles} models={models} onChange={setSteps} />
          ) : null}
```

Then disable Save while steps are invalid. In both the `useRegisterSave(save, ...)` call and the header `Button`, require `!stepsError`:

```tsx
  useRegisterSave(save, dirty && !saving && !stepsError);
```

```tsx
            <Button variant="primary" onClick={save} disabled={!dirty || saving || Boolean(stepsError)}>
```

The `stepsError` message reaches the user via `setNote(stepsError)` when a blocked save is attempted (the `note` is already rendered in the `actions` slot).

- [ ] **Step 7: Typecheck the modified file**

Run: `npx tsc -p tsconfig.json --noEmit 2>&1 | grep "LibraryFile" || echo "no new errors in LibraryFile"`
Expected: `no new errors in LibraryFile` (ignore unrelated baseline errors).

- [ ] **Step 8: Re-run the round-trip and helper tests**

Run: `npx vitest run src/web/shell/createItem.test.ts src/web/views/libraries/workflowSteps.test.ts`
Expected: PASS (all green).

- [ ] **Step 9: Commit**

```bash
git add src/web/views/libraries/LibraryFile.tsx
git commit -m "feat(web): edit workflow steps in the library editor"
```

---

## Task 5: Manual verification

- [ ] **Step 1: Run the app and exercise the editor**

Start the app (see the project run skill / `package.json` scripts), open `/libraries/workflows/spec-driven`, and verify:
1. The three steps render with editable name, role dropdown, model dropdown, and a `gate` checkbox (the `verify` step's gate is checked).
2. Add a step, reorder with ↑/↓, edit a name, toggle a gate, then Save.
3. Clearing a step name disables Save (validation).
4. On disk, `.sloop/workflows/spec-driven.md` reflects the edits **and still has `gate: true` on the gated step** — confirming the round-trip.

- [ ] **Step 2: Confirm no regression in serialization**

Run: `git diff --stat` then `npx vitest run src/web/shell/createItem.test.ts src/web/views/libraries/workflowSteps.test.ts`
Expected: tests green; only the intended files changed.

---

## Self-review notes

- **Spec coverage:** steps editable in-app (Tasks 3-4) ✓; full structural editing — add/remove/reorder/name/role/model/gate (Tasks 2-3) ✓; gate round-trip fix as single source of truth in `serializeWorkflow` (Task 1) ✓; validation ≥1 step + non-empty name + role + model (Tasks 2, 4) ✓; tests for serializer round-trip and helpers (Tasks 1-2) ✓; out-of-scope items (id rename, drag-drop, new endpoint) not introduced ✓.
- **`gate` fix covers all call sites:** `serializeWorkflow` is shared by create (createItem.ts:104), edit (LibraryFile), and rename/duplicate (`serializeLibrary`, createItem.ts:136), so Task 1 fixes the bug everywhere.
- **Type consistency:** `WorkflowStep` is defined once in `workflowSteps.ts` and imported by the component and `LibraryFile`; helper names (`makeStep`, `addStep`, `removeStep`, `moveStep`, `updateStep`, `validateSteps`, `withCurrent`) are used identically across tasks.
