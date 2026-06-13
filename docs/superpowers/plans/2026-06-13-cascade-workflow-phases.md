# Cascade Workflow Phases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tag every cascade leaf with the workflow step it fulfills, and render the mission-control cascade as an ordered, phase-grouped tree that shows every workflow step (including ones with no leaves yet) and its aggregate status.

**Architecture:** Add an optional `step` name to `LoopFrontmatter` (and the architect's `ProposedLeaf`). The architect emits the step per leaf; parsing falls back to the role-matched step. The cascade engine writes `step` onto each leaf. A new pure helper groups the architect's leaf children by workflow step into ordered `PhaseGroup`s; a new `LoopPhaseGroup` component renders each phase header (step name, role/model defaults, gate marker, aggregate status) above the existing `LoopNode` leaf rows. The architect node delegates child rendering to these groups via a `renderChildren` prop.

**Tech Stack:** TypeScript, React, React Router, Vitest. Existing design primitives: `Tag`, `StatusDot`, `roleTone`, `cx`. Tree rails: `RailCell`/`ElbowCell`/`Gutter` (extracted to a shared module in this plan).

**Spec:** `docs/superpowers/specs/2026-06-13-cascade-workflow-phases-design.md`

---

## File Structure

- `src/shared/types.ts` — **modify**: add `step?` to `LoopFrontmatter`.
- `src/server/planner/prompt.ts` — **modify**: add `step` to `ProposedLeaf`, the prompt schema/rule, and `resolveLeafStep` in `parseArchitectResponse`.
- `src/server/planner/architect.test.ts` — **modify**: cover step in prompt + parse.
- `src/server/cascade/cascadeEngine.ts` — **modify**: write `step` onto leaf frontmatter.
- `src/server/cascade/cascadeEngine.test.ts` — **modify**: assert `step` is persisted.
- `src/web/views/mission-control/phaseGroups.ts` — **create**: pure grouping + aggregate-status helpers.
- `src/web/views/mission-control/phaseGroups.test.ts` — **create**: unit tests for the helpers.
- `src/web/views/mission-control/railCells.tsx` — **create**: extracted `RailCell`/`ElbowCell`/`Gutter`.
- `src/web/views/mission-control/LoopNode.tsx` — **modify**: import rails from the shared module; add `showRoleTag` + `renderChildren` props.
- `src/web/views/mission-control/LoopPhaseGroup.tsx` — **create**: one phase header + its leaves.
- `src/web/views/mission-control/useWorkflow.ts` — **create**: fetch a `WorkflowDef` by id.
- `src/web/views/mission-control/LoopTree.tsx` — **modify**: accept `workflow`, render the architect's children as phase groups.
- `src/web/views/mission-control/CascadeView.tsx` — **modify**: resolve the workflow and pass it to `LoopTree`.

---

### Task 1: Add `step` to the data model

**Files:**
- Modify: `src/shared/types.ts:16-28` (`LoopFrontmatter`)
- Modify: `src/server/planner/prompt.ts:24-32` (`ProposedLeaf`)

- [ ] **Step 1: Add `step` to `LoopFrontmatter`**

In `src/shared/types.ts`, add the field after `workflow?: string;`:

```ts
export interface LoopFrontmatter {
  id: string;
  kind: LoopKind;
  role: string;
  model: string;
  status: LoopStatus;
  delta?: Delta;
  parent?: string;
  children: string[];
  sourceAdr?: string;
  workflow?: string;
  step?: string;        // name of the workflow step this leaf fulfills, e.g. "implement"
  acceptanceCriteria: AcceptanceCriterion[];
  executor?: string;
}
```

- [ ] **Step 2: Add `step` to `ProposedLeaf`**

In `src/server/planner/prompt.ts`, add the field after `sourceAdr?: string;`:

```ts
export interface ProposedLeaf {
  id: string;
  role: string;
  model: string;
  delta?: Delta;
  sourceAdr?: string;
  step?: string;        // resolved workflow step name (see parseArchitectResponse)
  brief: string;
  acceptanceCriteria: ProposedCriterion[];
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS (no errors). `step` is optional, so no existing construction site breaks.

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts src/server/planner/prompt.ts
git commit -m "feat(shared): add optional workflow step to loop frontmatter + proposed leaf"
```

---

### Task 2: Architect emits and parses the step

**Files:**
- Modify: `src/server/planner/prompt.ts` (prompt schema/rule + `resolveLeafStep` + parse map)
- Test: `src/server/planner/architect.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/server/planner/architect.test.ts`, the existing top-of-file `workflow` fixture has steps `plan`/`implement`/`verify` (roles `architect`/`engineer`/`qa`). Add these tests.

Add to the `describe('buildArchitectPrompt', …)` block:

```ts
  it('asks the planner to tag each leaf with a workflow step', () => {
    const { systemPrompt } = buildArchitectPrompt(diff, workflow, roles, 4);
    expect(systemPrompt).toContain('"step"');
    expect(systemPrompt).toContain('the step whose role it fulfills');
  });
```

Add to the `describe('parseArchitectResponse', …)` block:

```ts
  it('keeps a valid step name from the planner', () => {
    const resp = JSON.stringify({
      summary: 's',
      leaves: [
        { id: 'a', role: 'engineer', model: 'haiku', step: 'implement', brief: 'b', acceptanceCriteria: [] },
      ],
    });
    expect(parseArchitectResponse(resp, opts).leaves[0].step).toBe('implement');
  });

  it('falls back to the role-matched step when step is missing or unknown', () => {
    const resp = JSON.stringify({
      summary: 's',
      leaves: [
        { id: 'a', role: 'qa', model: 'sonnet', brief: 'b', acceptanceCriteria: [] },
        { id: 'b', role: 'engineer', model: 'haiku', step: 'nonsense', brief: 'b', acceptanceCriteria: [] },
      ],
    });
    const plan = parseArchitectResponse(resp, opts);
    expect(plan.leaves[0].step).toBe('verify');     // qa → verify step
    expect(plan.leaves[1].step).toBe('implement');  // unknown name → role match
  });

  it('leaves step undefined when no workflow step matches the role', () => {
    const resp = JSON.stringify({
      summary: 's',
      leaves: [
        { id: 'a', role: 'explorer', model: 'haiku', brief: 'b', acceptanceCriteria: [] },
      ],
    });
    expect(parseArchitectResponse(resp, opts).leaves[0].step).toBeUndefined();
  });
```

> Note: `opts` is the existing parse-options fixture in this file (it already carries `workflow`, `roles`, `plannerAlias`, `maxLeaves`). If a local `opts` is not in scope in the `parseArchitectResponse` describe block, reuse the one already used by the neighbouring parse tests in this file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/server/planner/architect.test.ts`
Expected: FAIL — prompt does not contain `"step"`; `plan.leaves[0].step` is `undefined` where a value is expected.

- [ ] **Step 3: Add the step to the prompt schema and rules**

In `src/server/planner/prompt.ts`, inside `buildArchitectPrompt`'s `systemPrompt` array, add a rule line in the `Rules:` block (after the role/model line that ends "…long-horizon tasks."):

```ts
    "- Tag each leaf with the step whose role it fulfills: set \"step\" to the exact",
    '  name from the Steps list above.',
```

And in the JSON shape example, add the `step` line after the `"sourceAdr"` line:

```ts
    '      "sourceAdr": "adr-007",',
    '      "step": "implement",',
    '      "brief": "what this leaf must do",',
```

- [ ] **Step 4: Add `resolveLeafStep` and populate it during parsing**

In `src/server/planner/prompt.ts`, add a helper next to `resolveLeafModel`:

```ts
function resolveLeafStep(
  rawStep: unknown,
  role: string,
  workflow: WorkflowDef,
): string | undefined {
  if (typeof rawStep === 'string' && workflow.steps.some((s) => s.name === rawStep.trim())) {
    return rawStep.trim();
  }
  // Fall back to the first workflow step whose role matches this leaf's role.
  return workflow.steps.find((s) => s.role === role)?.name;
}
```

Then in `parseArchitectResponse`, inside the `rawLeaves.map(...)` return object, add `step` after `sourceAdr`:

```ts
    return {
      id,
      role,
      model: resolveLeafModel(l.model, role, opts.workflow, opts.roles),
      delta,
      sourceAdr:
        typeof l.sourceAdr === 'string' && l.sourceAdr.trim() ? l.sourceAdr.trim() : undefined,
      step: resolveLeafStep(l.step, role, opts.workflow),
      brief,
      acceptanceCriteria,
    };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/server/planner/architect.test.ts`
Expected: PASS (all tests in the file green).

- [ ] **Step 6: Commit**

```bash
git add src/server/planner/prompt.ts src/server/planner/architect.test.ts
git commit -m "feat(planner): architect tags each leaf with its workflow step"
```

---

### Task 3: Persist `step` onto leaf frontmatter

**Files:**
- Modify: `src/server/cascade/cascadeEngine.ts:239-260` (leaf frontmatter build)
- Test: `src/server/cascade/cascadeEngine.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/server/cascade/cascadeEngine.test.ts`, add `step` to the first leaf of the `PLAN` fixture (after its `sourceAdr: 'adr-007',` line):

```ts
      sourceAdr: 'adr-007',
      step: 'implement',
      brief: 'Rotate tokens.',
```

Then, in the existing test `it('diffs, runs the architect, and writes an awaiting-approval tree', …)`, add an assertion next to the other `leaf.frontmatter.*` checks:

```ts
    expect(leaf.frontmatter.step).toBe('implement');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/cascade/cascadeEngine.test.ts`
Expected: FAIL — `leaf.frontmatter.step` is `undefined` (the engine does not yet copy it).

- [ ] **Step 3: Copy `step` into the leaf frontmatter**

In `src/server/cascade/cascadeEngine.ts`, inside `buildLoops`'s `plan.leaves.map((leaf) => { const fm: LoopFrontmatter = {…} })`, add `step` after `workflow: workflowId,`:

```ts
        parent: ROOT_LOOP_ID,
        children: [],
        sourceAdr: leaf.sourceAdr,
        workflow: workflowId,
        step: leaf.step,
        executor: 'pi',
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/server/cascade/cascadeEngine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/cascade/cascadeEngine.ts src/server/cascade/cascadeEngine.test.ts
git commit -m "feat(cascade): persist the workflow step on each leaf loop"
```

---

### Task 4: Pure phase-grouping helper

**Files:**
- Create: `src/web/views/mission-control/phaseGroups.ts`
- Test: `src/web/views/mission-control/phaseGroups.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/web/views/mission-control/phaseGroups.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { LoopDoc, LoopStatus, WorkflowDef } from '../../api-client/index';
import { aggregatePhaseStatus, buildPhaseGroups } from './phaseGroups';

const workflow: WorkflowDef = {
  id: 'spec-driven',
  name: 'Spec-driven',
  steps: [
    { name: 'plan', role: 'architect', model: 'opus' },
    { name: 'implement', role: 'engineer', model: 'haiku' },
    { name: 'verify', role: 'qa', model: 'sonnet', gate: true },
  ],
  guidance: '',
};

function leaf(id: string, step: string | undefined, status: LoopStatus): LoopDoc {
  return {
    frontmatter: {
      id,
      kind: 'leaf',
      role: 'engineer',
      model: 'haiku',
      status,
      children: [],
      step,
      acceptanceCriteria: [],
    },
    body: '',
    relPath: `cascades/x/${id}.md`,
  };
}

describe('aggregatePhaseStatus', () => {
  it('is queued for an empty phase', () => {
    expect(aggregatePhaseStatus([])).toBe('queued');
  });
  it('is failed if any leaf failed', () => {
    expect(aggregatePhaseStatus([leaf('a', 'implement', 'done'), leaf('b', 'implement', 'failed')])).toBe('failed');
  });
  it('is executing if any leaf is active and none failed', () => {
    expect(aggregatePhaseStatus([leaf('a', 'implement', 'done'), leaf('b', 'implement', 'review')])).toBe('executing');
  });
  it('is done only when every leaf is done', () => {
    expect(aggregatePhaseStatus([leaf('a', 'implement', 'done'), leaf('b', 'implement', 'done')])).toBe('done');
  });
  it('is queued when leaves are still planned/queued', () => {
    expect(aggregatePhaseStatus([leaf('a', 'implement', 'planned'), leaf('b', 'implement', 'queued')])).toBe('queued');
  });
});

describe('buildPhaseGroups', () => {
  it('orders groups by the workflow, not by leaf order', () => {
    const leaves = [leaf('v', 'verify', 'queued'), leaf('p', 'plan', 'done')];
    const groups = buildPhaseGroups(leaves, workflow);
    expect(groups.map((g) => g.step?.name)).toEqual(['plan', 'implement', 'verify']);
    expect(groups.map((g) => g.index)).toEqual([1, 2, 3]);
  });

  it('includes empty phases as queued', () => {
    const groups = buildPhaseGroups([leaf('p', 'plan', 'done')], workflow);
    const implement = groups.find((g) => g.step?.name === 'implement')!;
    expect(implement.leaves).toHaveLength(0);
    expect(implement.status).toBe('queued');
  });

  it('collects undefined/mismatched steps into a trailing Unphased group', () => {
    const leaves = [leaf('p', 'plan', 'done'), leaf('x', undefined, 'queued'), leaf('y', 'ghost', 'queued')];
    const groups = buildPhaseGroups(leaves, workflow);
    const last = groups[groups.length - 1];
    expect(last.step).toBeNull();
    expect(last.index).toBe(0);
    expect(last.leaves.map((l) => l.frontmatter.id)).toEqual(['x', 'y']);
  });

  it('omits the Unphased group when every leaf is phased', () => {
    const groups = buildPhaseGroups([leaf('p', 'plan', 'done')], workflow);
    expect(groups.some((g) => g.step === null)).toBe(false);
  });

  it('puts all leaves in a single Unphased group when the workflow is null', () => {
    const groups = buildPhaseGroups([leaf('p', 'plan', 'done')], null);
    expect(groups).toHaveLength(1);
    expect(groups[0].step).toBeNull();
    expect(groups[0].leaves).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/web/views/mission-control/phaseGroups.test.ts`
Expected: FAIL with "Failed to resolve import './phaseGroups'".

- [ ] **Step 3: Implement the helper**

Create `src/web/views/mission-control/phaseGroups.ts`:

```ts
// Groups the architect's leaf children into ordered workflow phases. A "phase" is the
// set of leaves fulfilling one workflow step; phases render in workflow order, including
// steps with no leaves yet. Leaves with no matching step collect into a trailing
// "Unphased" group. Pure + framework-free so it can be unit-tested in isolation.

import type { LoopDoc, LoopStatus, WorkflowDef } from '../../api-client/index';

export interface PhaseGroup {
  /** Stable React key. */
  key: string;
  /** The workflow step, or null for the trailing "Unphased" group. */
  step: WorkflowDef['steps'][number] | null;
  /** 1-based display index; 0 for the Unphased group. */
  index: number;
  leaves: LoopDoc[];
  /** Derived aggregate status across the group's leaves. */
  status: LoopStatus;
}

const ACTIVE: ReadonlySet<LoopStatus> = new Set(['executing', 'review']);

export function aggregatePhaseStatus(leaves: LoopDoc[]): LoopStatus {
  if (leaves.length === 0) return 'queued';
  const statuses = leaves.map((l) => l.frontmatter.status);
  if (statuses.includes('failed')) return 'failed';
  if (statuses.some((s) => ACTIVE.has(s))) return 'executing';
  if (statuses.every((s) => s === 'done')) return 'done';
  return 'queued';
}

export function buildPhaseGroups(leaves: LoopDoc[], workflow: WorkflowDef | null): PhaseGroup[] {
  const steps = workflow?.steps ?? [];
  const stepNames = new Set(steps.map((s) => s.name));
  const byStep = new Map<string, LoopDoc[]>();
  const unphased: LoopDoc[] = [];

  for (const leaf of leaves) {
    const step = leaf.frontmatter.step;
    if (step && stepNames.has(step)) {
      const bucket = byStep.get(step) ?? [];
      bucket.push(leaf);
      byStep.set(step, bucket);
    } else {
      unphased.push(leaf);
    }
  }

  const groups: PhaseGroup[] = steps.map((step, i) => {
    const groupLeaves = byStep.get(step.name) ?? [];
    return {
      key: step.name,
      step,
      index: i + 1,
      leaves: groupLeaves,
      status: aggregatePhaseStatus(groupLeaves),
    };
  });

  if (unphased.length > 0) {
    groups.push({
      key: '__unphased__',
      step: null,
      index: 0,
      leaves: unphased,
      status: aggregatePhaseStatus(unphased),
    });
  }

  return groups;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/web/views/mission-control/phaseGroups.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/views/mission-control/phaseGroups.ts src/web/views/mission-control/phaseGroups.test.ts
git commit -m "feat(web): pure helper grouping cascade leaves into workflow phases"
```

---

### Task 5: Extract tree-rail primitives into a shared module

**Files:**
- Create: `src/web/views/mission-control/railCells.tsx`
- Modify: `src/web/views/mission-control/LoopNode.tsx:13-43` (remove the three local fns) + imports

This is a pure refactor (no behavior change) so `LoopPhaseGroup` can reuse the rails.

- [ ] **Step 1: Create the shared module**

Create `src/web/views/mission-control/railCells.tsx` with the three functions moved verbatim from `LoopNode.tsx`:

```tsx
// Tree-connector primitives shared by LoopNode and LoopPhaseGroup. One indentation
// column is 24px wide; the rail sits at its horizontal centre (12px) so elbows and
// pass-throughs from every depth line up vertically.

// One indentation column. The rail is a vertical line when `line` is true.
export function RailCell({ line }: { line: boolean }) {
  return (
    <span className="relative w-6 shrink-0 self-stretch" aria-hidden>
      {line && <span className="absolute bottom-0 left-3 top-0 w-px bg-line-soft" />}
    </span>
  );
}

// The connector that joins a node to its parent: a rounded "└"/"├" reaching from the
// rail centre across to the row content, plus a downward continuation when the node
// has younger siblings.
export function ElbowCell({ last }: { last: boolean }) {
  return (
    <span className="relative w-6 shrink-0 self-stretch" aria-hidden>
      <span className="absolute bottom-1/2 left-3 right-0 top-0 rounded-bl-[6px] border-b border-l border-line-soft" />
      {!last && <span className="absolute bottom-0 left-3 top-1/2 w-px bg-line-soft" />}
    </span>
  );
}

export function Gutter({ lines }: { lines: boolean[] }) {
  return (
    <>
      {lines.map((line, i) => (
        <RailCell key={i} line={line} />
      ))}
    </>
  );
}
```

- [ ] **Step 2: Replace the local definitions in `LoopNode.tsx` with an import**

In `src/web/views/mission-control/LoopNode.tsx`, delete the local `RailCell`, `ElbowCell`, and `Gutter` function definitions (lines 13-43, including their leading comments) and add this import at the top. `LoopNode` references only `Gutter` and `ElbowCell` directly (`RailCell` is used internally by `Gutter` inside the new module), so import exactly these two:

```tsx
import { ElbowCell, Gutter } from './railCells';
```

- [ ] **Step 3: Typecheck + run the existing tree tests**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS.

Run: `npx vitest run src/web/views/mission-control`
Expected: PASS (no behavior change; existing cascade/text tests stay green).

- [ ] **Step 4: Commit**

```bash
git add src/web/views/mission-control/railCells.tsx src/web/views/mission-control/LoopNode.tsx
git commit -m "refactor(web): extract tree-rail primitives into railCells"
```

---

### Task 6: `LoopNode` supports custom child rendering and an optional role tag

**Files:**
- Modify: `src/web/views/mission-control/LoopNode.tsx` (props + role tag render + children render)

- [ ] **Step 1: Extend the props**

In `src/web/views/mission-control/LoopNode.tsx`, add `import type { ReactNode } from 'react';` (merge into the existing `react` import if present), then add two optional props to `LoopNodeProps`:

```tsx
export interface LoopNodeProps {
  loop: LoopDoc;
  cascadeId: string;
  roleLabel: (roleId: string) => string;
  getChildren: (loopId: string) => LoopDoc[];
  outputOf: (loopId: string) => string;
  depth?: number;
  ancestors?: boolean[];
  isLast?: boolean;
  /** Hide the role tag (a wrapping phase header already names the role). Default true. */
  showRoleTag?: boolean;
  /** Render this node's children instead of the default recursion (architect → phases). */
  renderChildren?: (childRails: boolean[]) => ReactNode;
}
```

And destructure them in the function signature with defaults:

```tsx
export function LoopNode({
  loop,
  cascadeId,
  roleLabel,
  getChildren,
  outputOf,
  depth = 0,
  ancestors = [],
  isLast = true,
  showRoleTag = true,
  renderChildren,
}: LoopNodeProps) {
```

- [ ] **Step 2: Make the role tag conditional**

In `LoopNode.tsx`, wrap the role `Tag` (currently `<Tag tone={roleTone(fm.role)}>{roleLabel(fm.role)}</Tag>`):

```tsx
          {showRoleTag && <Tag tone={roleTone(fm.role)}>{roleLabel(fm.role)}</Tag>}
```

- [ ] **Step 3: Delegate child rendering when `renderChildren` is provided**

In `LoopNode.tsx`, replace the children map (the `{children.map((child, i) => ( … ))}` block at the end of the `open && hasDisclosure` section) with:

```tsx
          {renderChildren
            ? renderChildren(childRails)
            : children.map((child, i) => (
                <LoopNode
                  key={child.frontmatter.id}
                  loop={child}
                  cascadeId={cascadeId}
                  roleLabel={roleLabel}
                  getChildren={getChildren}
                  outputOf={outputOf}
                  depth={depth + 1}
                  ancestors={childRails}
                  isLast={i === children.length - 1}
                />
              ))}
```

- [ ] **Step 4: Typecheck + run tree tests**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS.

Run: `npx vitest run src/web/views/mission-control`
Expected: PASS (defaults preserve current behavior — `showRoleTag` defaults true, `renderChildren` undefined).

- [ ] **Step 5: Commit**

```bash
git add src/web/views/mission-control/LoopNode.tsx
git commit -m "feat(web): LoopNode supports optional role tag + custom child rendering"
```

---

### Task 7: `LoopPhaseGroup` component

**Files:**
- Create: `src/web/views/mission-control/LoopPhaseGroup.tsx`

- [ ] **Step 1: Create the component**

Create `src/web/views/mission-control/LoopPhaseGroup.tsx`:

```tsx
// One workflow phase in the cascade: a header row (index · step name, role/model
// defaults, optional gate marker, aggregate status) above the phase's leaf rows.
// The header sits one indentation level under the architect; its leaves sit one level
// deeper, reusing LoopNode for each leaf row.

import { useEffect, useState } from 'react';
import type { LoopDoc } from '../../api-client/index';
import { StatusDot, Tag, cx, roleTone } from '../../design/index';
import { ElbowCell, Gutter } from './railCells';
import { LoopNode } from './LoopNode';
import type { PhaseGroup } from './phaseGroups';

const ACTIVE = new Set(['executing', 'review']);

export interface LoopPhaseGroupProps {
  group: PhaseGroup;
  cascadeId: string;
  roleLabel: (roleId: string) => string;
  getChildren: (loopId: string) => LoopDoc[];
  outputOf: (loopId: string) => string;
  /** Pass-through rails inherited from the architect level. */
  ancestors: boolean[];
  /** Whether this is the last phase among its siblings (controls elbow + rail). */
  isLast: boolean;
}

export function LoopPhaseGroup({
  group,
  cascadeId,
  roleLabel,
  getChildren,
  outputOf,
  ancestors,
  isLast,
}: LoopPhaseGroupProps) {
  const { step, leaves, status, index } = group;
  const active = ACTIVE.has(status);
  const [open, setOpen] = useState(true);

  // Keep an active phase open so its streaming leaves stay visible.
  useEffect(() => {
    if (active) setOpen(true);
  }, [active]);

  const total = leaves.length;
  const done = leaves.filter((l) => l.frontmatter.status === 'done').length;
  const label = step ? `${index} · ${step.name}` : 'Unphased';
  const defaults = step
    ? `${roleLabel(step.role)} · ${step.model}`
    : `${total} loop${total === 1 ? '' : 's'}`;

  // Leaves are children of this phase: they inherit this phase's pass-through rail.
  const childRails = [...ancestors, !isLast];

  return (
    <div className="border-b border-line-soft">
      <div className="flex items-stretch px-1 transition-colors hover:bg-line-soft">
        <Gutter lines={ancestors} />
        <ElbowCell last={isLast} />

        <div className="flex flex-1 items-center gap-2.5 py-2">
          <button
            type="button"
            onClick={() => total > 0 && setOpen((o) => !o)}
            className={cx(
              'select-none text-[11px] text-ink-subtle',
              total === 0 && 'pointer-events-none opacity-0',
            )}
            aria-label={open ? 'Collapse phase' : 'Expand phase'}
          >
            {open ? '▾' : '▸'}
          </button>

          <Tag tone={roleTone(step?.role)}>{label}</Tag>
          {step?.gate && (
            <span className="rounded border border-line-soft px-1.5 text-[10px] uppercase tracking-wide text-status-running">
              gate
            </span>
          )}
          <span className="text-[11.5px] text-ink-faint">{defaults}</span>

          <span className="ml-auto flex items-center gap-1.5">
            <StatusDot status={status} />
            {total > 0 && (
              <span className="text-[11.5px] text-ink-faint">
                · {done}/{total}
              </span>
            )}
          </span>
        </div>
      </div>

      {open &&
        leaves.map((leaf, i) => (
          <LoopNode
            key={leaf.frontmatter.id}
            loop={leaf}
            cascadeId={cascadeId}
            roleLabel={roleLabel}
            getChildren={getChildren}
            outputOf={outputOf}
            depth={1}
            ancestors={childRails}
            isLast={i === leaves.length - 1}
            showRoleTag={false}
          />
        ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS. (`roleTone(undefined)` returns `'gray'`, a valid `Tone`; `PhaseGroup` is imported from Task 4.)

- [ ] **Step 3: Commit**

```bash
git add src/web/views/mission-control/LoopPhaseGroup.tsx
git commit -m "feat(web): LoopPhaseGroup renders one workflow phase header + its leaves"
```

---

### Task 8: `useWorkflow` hook

**Files:**
- Create: `src/web/views/mission-control/useWorkflow.ts`

- [ ] **Step 1: Create the hook**

Create `src/web/views/mission-control/useWorkflow.ts` (mirrors `useRoleLabel.ts`):

```ts
// Resolves a cascade's workflow id to its full WorkflowDef (steps, roles, models, gates)
// so the cascade view can render the chosen workflow's ordered phases. Returns null
// until the workflow library has loaded or when the id is unknown.

import { useEffect, useMemo, useState } from 'react';
import { getWorkflows, type WorkflowDef } from '../../api-client/index';

export function useWorkflow(workflowId: string | undefined): WorkflowDef | null {
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  useEffect(() => {
    let active = true;
    getWorkflows()
      .then((w) => active && setWorkflows(w))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return useMemo(
    () => workflows.find((w) => w.id === workflowId) ?? null,
    [workflows, workflowId],
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/web/views/mission-control/useWorkflow.ts
git commit -m "feat(web): useWorkflow hook resolves a cascade's WorkflowDef"
```

---

### Task 9: Wire phases into `LoopTree` and `CascadeView`

**Files:**
- Modify: `src/web/views/mission-control/LoopTree.tsx`
- Modify: `src/web/views/mission-control/CascadeView.tsx`

- [ ] **Step 1: Accept a `workflow` prop and render the architect's children as phases**

In `src/web/views/mission-control/LoopTree.tsx`, add imports:

```tsx
import type { LoopDoc, WorkflowDef } from '../../api-client/index';
import { LoopNode } from './LoopNode';
import { LoopPhaseGroup } from './LoopPhaseGroup';
import { buildPhaseGroups } from './phaseGroups';
```

Add `workflow` to `LoopTreeProps`:

```tsx
export interface LoopTreeProps {
  loops: LoopDoc[];
  rootLoopId: string;
  cascadeId: string;
  roleLabel: (roleId: string) => string;
  outputs: Record<string, string>;
  workflow: WorkflowDef | null;
}
```

Destructure `workflow` in the function signature, then replace the returned `<LoopNode … />` for the root with a version that passes `renderChildren`:

```tsx
  return (
    <LoopNode
      loop={root}
      cascadeId={cascadeId}
      roleLabel={roleLabel}
      getChildren={getChildren}
      outputOf={(id) => outputs[id] ?? ''}
      renderChildren={(childRails) => {
        const groups = buildPhaseGroups(getChildren(root.frontmatter.id), workflow);
        return groups.map((group, i) => (
          <LoopPhaseGroup
            key={group.key}
            group={group}
            cascadeId={cascadeId}
            roleLabel={roleLabel}
            getChildren={getChildren}
            outputOf={(id) => outputs[id] ?? ''}
            ancestors={childRails}
            isLast={i === groups.length - 1}
          />
        ));
      }}
    />
  );
```

> `root.frontmatter.id` is the architect's id; `getChildren` already returns its ordered leaf children. The architect node still owns its own row, disclosure toggle, and rails — only its child rendering is now phase-grouped.

- [ ] **Step 2: Resolve the workflow in `CascadeView` and pass it down**

In `src/web/views/mission-control/CascadeView.tsx`:

Add the import next to `useRoleLabel`:

```tsx
import { useWorkflow } from './useWorkflow';
```

Resolve the workflow with an **unconditional** hook call. `CascadeView` has early `return`s for the `error` and loading states, so the hook must run before them. Place it right after `const roleLabel = useRoleLabel();` near the top of the component, reading the id off the optional `detail`:

```tsx
  const roleLabel = useRoleLabel();
  const workflow = useWorkflow(detail?.summary.workflow);
```

`useWorkflow` returns `null` while `detail` is still loading (id is `undefined`), which `LoopTree`/`buildPhaseGroups` already handle. Do not add a second `useWorkflow` call later in the component.

Then add `workflow={workflow}` to the existing `<LoopTree … />` JSX:

```tsx
        <LoopTree
          loops={loops}
          rootLoopId={summary.rootLoopId}
          cascadeId={id}
          roleLabel={roleLabel}
          outputs={outputs}
          workflow={workflow}
        />
```

> The exact existing prop list may differ slightly; add `workflow={workflow}` to whatever props are already passed.

- [ ] **Step 3: Typecheck + run the mission-control tests**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: PASS.

Run: `npx vitest run src/web/views/mission-control`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/web/views/mission-control/LoopTree.tsx src/web/views/mission-control/CascadeView.tsx
git commit -m "feat(web): render the cascade as workflow-ordered phase groups"
```

---

### Task 10: Full verification + manual check

**Files:**
- No new files.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS (all suites green).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: PASS (`tsc --noEmit` + `vite build` succeed).

- [ ] **Step 3: Confirm only intended files changed**

Run: `git diff --stat main...HEAD`
Expected: only the files listed in this plan's File Structure section.

- [ ] **Step 4: Manual browser check**

Start the app (per the project's run instructions), open a cascade in Mission Control, and confirm:
- the architect row now shows ordered phase headers (`1 · plan`, `2 · implement`, `3 · verify`) for the chosen workflow;
- a step with no leaves still appears, marked queued;
- each leaf sits under its phase, with the phase header carrying role/model and a `gate` marker where applicable;
- an older cascade (leaves without `step`) shows a single "Unphased" group and still renders all its leaves.

- [ ] **Step 5: Final commit (if the manual check prompted any tweak)**

```bash
git add -A
git commit -m "chore(web): cascade workflow-phase visualization verified"
```

---

## Notes for the implementer

- **Hook ordering (Task 9, Step 2):** React requires hooks to run unconditionally and in the same order every render. `CascadeView` has early `return`s for the `error` and loading states. Call `useWorkflow(detail?.summary.workflow)` alongside the other top-level hooks (after `useRoleLabel()`), *before* any early return — not after `const { summary } = detail;`. Passing `undefined` while `detail` is still loading is fine; the hook returns `null` until the id resolves.
- **Rails:** the architect is the tree root (no incoming rail). Phase headers are one indentation level under it (`Gutter(ancestors=[]) + ElbowCell`); leaves are one level deeper (`ancestors=[!isLastPhase]`), so the vertical rail continues past a non-last phase and stops at the last one. This mirrors how `LoopNode` already nests normal children.
- **No new status colors:** the `gate` marker reuses `text-status-running` + `border-line-soft`; aggregate status reuses `StatusDot`, which already maps every `LoopStatus`.
