# Agent-Native Stages & Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deepen and modestly expand sloop's process templates and roles — grounded in multi-agent-coding research — by adding two light schema guardrails (`locked` criteria, stage `gate`s), polishing the stub templates, and adding `debug`/`migrate` templates plus `explorer`/`debugger` roles.

**Architecture:** Two optional, back-compatible fields are added to shared types and carried through the planner prompt + the disk-backed `FilesService`. The substantive content lives in markdown files under `fixtures/sample-workspace/.sloop/{templates,roles}/`. The frontend gains new role tones and a gate marker in the Libraries view. Runtime *enforcement* of `locked` is explicitly deferred to the WP-6 executor — this plan records the flag and the intent only.

**Tech Stack:** TypeScript, Vitest (node environment), React + Tailwind, gray-matter for frontmatter. Design spec: `docs/superpowers/specs/2026-06-13-agent-native-stages-roles-design.md`.

**Verification commands:** `npm run typecheck` (tsc --noEmit), `npm test` (vitest run).

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/shared/types.ts` | Add `AcceptanceCriterion.locked?`, stage `gate?` | 1 |
| `src/server/files/filesService.ts` | Carry `locked` through `normalizeCriteria` | 2 |
| `src/server/files/filesService.test.ts` | Assert `locked` round-trips | 2 |
| `src/server/planner/prompt.ts` | `ProposedCriterion.locked?`, parse it, surface gates + partition/lock/escalation rules | 3 |
| `src/server/planner/architect.test.ts` | Assert gate marker, rule text, locked carry-through | 3 |
| `src/web/design/tokens.ts` | New `teal`/`amber` tones + role mapping | 4 |
| `src/web/design/tokens.test.ts` (new) | `roleTone` for new roles | 4 |
| `tailwind.config.ts` | `role.teal/tealBg/amber/amberBg` colors | 4 |
| `src/web/views/libraries/Libraries.tsx` | Render gate stages distinctly | 5 |
| `fixtures/sample-workspace/.sloop/roles/*.md` | Polish 4 roles; add `explorer`, `debugger` | 6 |
| `fixtures/sample-workspace/.sloop/templates/*.md` | Polish 3 templates; add `debug`, `migrate` | 7 |

---

## Task 1: Schema fields

**Files:**
- Modify: `src/shared/types.ts:7-12` (`AcceptanceCriterion`) and `:52-57` (`TemplateDef`)

- [ ] **Step 1: Add `locked?` to `AcceptanceCriterion`**

Replace the interface (currently lines 7-12) with:

```ts
export interface AcceptanceCriterion {
  id: string;
  text: string;
  verify?: string;     // shell command; exit 0 = passed
  locked?: boolean;    // authored by the parent; the executing leaf must not weaken it
  passed: boolean;
}
```

- [ ] **Step 2: Add `gate?` to the `TemplateDef` stage shape**

Replace the `stages` line inside `TemplateDef` (currently line 55) with:

```ts
  stages: { name: string; role: string; model: string; gate?: boolean }[];
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors — both fields are optional and additive).

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add locked criteria + stage gate fields"
```

---

## Task 2: FilesService carries `locked`

The disk-backed loader explicitly maps criterion fields in `normalizeCriteria`, so it drops unknown keys. Add `locked`. (Stage `gate` needs no change — `listTemplates` passes `data.stages` through whole.)

**Files:**
- Modify: `src/server/files/filesService.ts:154-167` (`normalizeCriteria`)
- Test: `src/server/files/filesService.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test inside the top-level `describe` block in `src/server/files/filesService.test.ts` (e.g. after the existing "reads templates, roles…" test at line 106):

```ts
  it('carries the locked flag on acceptance criteria through normalizeCriteria', async () => {
    await fs.mkdir(path.join(root, 'databank'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'databank/adr-100.md'),
      [
        '---',
        'id: adr-100',
        'title: Locked criterion',
        'acceptanceCriteria:',
        '  - { id: ac-1, text: "stays locked", verify: "npm test", locked: true }',
        '  - { id: ac-2, text: "unlocked default" }',
        '---',
        '',
        'body',
      ].join('\n'),
      'utf8',
    );
    const files = createFilesService(root);
    const adr = (await files.listAdrs()).find((a) => a.id === 'adr-100');
    expect(adr?.acceptanceCriteria[0].locked).toBe(true);
    expect(adr?.acceptanceCriteria[1].locked).toBeUndefined();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/files/filesService.test.ts -t "carries the locked flag"`
Expected: FAIL — `expected undefined to be true` (the loader drops `locked`).

- [ ] **Step 3: Carry `locked` in `normalizeCriteria`**

In `src/server/files/filesService.ts`, inside `normalizeCriteria` (lines 157-165), add a line after the existing `verify` mapping (line 164):

```ts
    if (c.verify !== undefined) criterion.verify = String(c.verify);
    if (c.locked !== undefined) criterion.locked = Boolean(c.locked);
    return criterion;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/server/files/filesService.test.ts -t "carries the locked flag"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/files/filesService.ts src/server/files/filesService.test.ts
git commit -m "feat(files): carry locked flag through criterion loading"
```

---

## Task 3: Planner — carry `locked` + surface gates and rules

**Files:**
- Modify: `src/server/planner/prompt.ts` (`ProposedCriterion` :16-20, `buildArchitectPrompt` :60-141, criterion parse :243-251)
- Test: `src/server/planner/architect.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/server/planner/architect.test.ts`, add a test to the `buildArchitectPrompt` describe block (after line 101):

```ts
  it('marks gate stages and states the lock + partition rules', () => {
    const gated: TemplateDef = {
      ...template,
      stages: [
        template.stages[0],
        template.stages[1],
        { name: 'verify', role: 'qa', model: 'sonnet', gate: true },
      ],
    };
    const { systemPrompt, userPrompt } = buildArchitectPrompt(diff, gated, roles, 4);
    expect(userPrompt).toContain('[GATE]');
    expect(systemPrompt).toMatch(/locked/i);
    expect(systemPrompt).toMatch(/Partition leaves by file/i);
  });
```

And add a test to the `parseArchitectResponse` describe block (after line 115):

```ts
  it('carries the locked flag through on a criterion', () => {
    const resp = JSON.stringify({
      leaves: [
        {
          id: 'a',
          role: 'engineer',
          brief: 'x',
          acceptanceCriteria: [{ id: 'ac-1', text: 't', verify: 'npm test', locked: true }],
        },
      ],
    });
    const plan = parseArchitectResponse(resp, opts);
    expect(plan.leaves[0].acceptanceCriteria[0].locked).toBe(true);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/server/planner/architect.test.ts -t "gate stages"`
Expected: FAIL — `[GATE]` / `Partition` not found in the prompt.

Run: `npx vitest run src/server/planner/architect.test.ts -t "carries the locked"`
Expected: FAIL — `locked` is `undefined` (parser drops it).

- [ ] **Step 3: Add `locked?` to `ProposedCriterion`**

In `src/server/planner/prompt.ts`, replace `ProposedCriterion` (lines 16-20) with:

```ts
export interface ProposedCriterion {
  id: string;
  text: string;
  verify?: string;
  locked?: boolean;
}
```

- [ ] **Step 4: Mark gate stages in the stage list**

In `buildArchitectPrompt`, replace the `stageLines` map (lines 70-72) with:

```ts
  const stageLines = template.stages
    .map((s) => `- ${s.name}: role=${s.role}, model=${s.model}${s.gate ? ' [GATE]' : ''}`)
    .join('\n');
```

- [ ] **Step 5: Add the lock / partition / escalation rules to the system prompt**

In the `systemPrompt` array, replace the existing `Rules:` block (lines 96-102) with:

```ts
    'Rules:',
    `- Propose at most ${maxLeaves} leaves. Keep the tree shallow: architect → leaves.`,
    '- Give every leaf a stable kebab-case id, unique within this cascade.',
    '- Partition leaves by file: no two leaves may edit the same file (they share one',
    '  checkout and would collide).',
    "- Choose each leaf's role from the roles list and a model alias from the template",
    '  stage defaults or the role default. The stage model is a floor for bounded work;',
    "  raise a leaf's model for open-ended or long-horizon tasks.",
    '- Copy each acceptance criterion onto the leaf that satisfies it (stable id + text +',
    '  verify). Set "locked": true on every criterion you author — a locked criterion may',
    '  not be weakened by the leaf that executes it.',
    '- Stages marked [GATE] are hard verification checkpoints; their criteria must be',
    '  locked and backed by a concrete verify command.',
```

- [ ] **Step 6: Show `locked` in the JSON shape example**

In the same `systemPrompt` array, replace the example criterion line (line 116) with:

```ts
    '        { "id": "ac-1", "text": "…", "verify": "npm test -- rotation", "locked": true }',
```

- [ ] **Step 7: Parse `locked` from the response**

In `parseArchitectResponse`, replace the criterion mapping return (lines 245-250) with:

```ts
      return {
        id: typeof cc.id === 'string' && cc.id.trim() ? cc.id.trim() : `ac-${ci + 1}`,
        text: typeof cc.text === 'string' ? cc.text.trim() : '',
        verify:
          typeof cc.verify === 'string' && cc.verify.trim() ? cc.verify.trim() : undefined,
        locked: typeof cc.locked === 'boolean' ? cc.locked : undefined,
      };
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run src/server/planner/architect.test.ts`
Expected: PASS (all tests, including the two new ones and the existing suite).

- [ ] **Step 9: Commit**

```bash
git add src/server/planner/prompt.ts src/server/planner/architect.test.ts
git commit -m "feat(planner): carry locked criteria + surface gates and partition rules"
```

---

## Task 4: Design tokens for new role tones

**Files:**
- Modify: `src/web/design/tokens.ts:7,11-17,20-25`
- Modify: `tailwind.config.ts:55-66` (the `role` color block)
- Test: `src/web/design/tokens.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/web/design/tokens.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { roleTone } from './tokens';

describe('roleTone', () => {
  it('maps the new roles to dedicated tones', () => {
    expect(roleTone('explorer')).toBe('teal');
    expect(roleTone('debugger')).toBe('amber');
  });

  it('keeps the existing role mapping and falls back to gray', () => {
    expect(roleTone('architect')).toBe('purple');
    expect(roleTone('unknown-role')).toBe('gray');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/web/design/tokens.test.ts`
Expected: FAIL — `roleTone('explorer')` returns `'gray'`, not `'teal'`.

- [ ] **Step 3: Add the tones to `tokens.ts`**

In `src/web/design/tokens.ts`, replace the `Tone` type (line 7) with:

```ts
export type Tone = 'blue' | 'purple' | 'green' | 'pink' | 'gray' | 'teal' | 'amber';
```

Replace `TONE_CLASS` (lines 11-17) with:

```ts
export const TONE_CLASS: Record<Tone, string> = {
  blue: 'bg-role-blueBg text-role-blue',
  purple: 'bg-role-purpleBg text-role-purple',
  green: 'bg-role-greenBg text-role-green',
  pink: 'bg-role-pinkBg text-role-pink',
  gray: 'bg-role-grayBg text-role-gray',
  teal: 'bg-role-tealBg text-role-teal',
  amber: 'bg-role-amberBg text-role-amber',
};
```

Replace `ROLE_TONE` (lines 20-25) with:

```ts
const ROLE_TONE: Record<string, Tone> = {
  engineer: 'blue',
  architect: 'purple',
  qa: 'green',
  security: 'pink',
  explorer: 'teal',
  debugger: 'amber',
};
```

- [ ] **Step 4: Add the Tailwind colors**

In `tailwind.config.ts`, inside the `role:` color block (lines 55-66), replace the `gray`/`grayBg` pair (lines 64-65) with these six lines (the two existing plus four new):

```ts
          gray: '#615f5a',
          grayBg: '#f1f0ee',
          teal: '#2f8f80',
          tealBg: '#e6f4f1',
          amber: '#a8722f',
          amberBg: '#f7efe3',
```

- [ ] **Step 5: Run the test + typecheck**

Run: `npx vitest run src/web/design/tokens.test.ts`
Expected: PASS.

Run: `npm run typecheck`
Expected: PASS (`TONE_CLASS` is exhaustive over the widened `Tone`).

- [ ] **Step 6: Commit**

```bash
git add src/web/design/tokens.ts src/web/design/tokens.test.ts tailwind.config.ts
git commit -m "feat(design): teal/amber tones for explorer + debugger roles"
```

---

## Task 5: Render gate stages distinctly in Libraries

No frontend test harness exists (vitest env is `node`, no jsdom/testing-library), so this task is verified by typecheck + manual inspection. The change is a small marker, not a redesign.

**Files:**
- Modify: `src/web/views/libraries/Libraries.tsx` (detail-view stage line ~123-125; list-view stage line ~190-192; add `StagePipeline` near `SectionHead`)

- [ ] **Step 1: Add a stage-pipeline helper**

In `src/web/views/libraries/Libraries.tsx`, add this component near the bottom of the file (next to `SectionHead`):

```tsx
// Stage pipeline: gate stages (hard verification checkpoints) get a dotted underline.
function StagePipeline({ stages }: { stages: TemplateDef['stages'] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {stages.map((s, i) => (
        <span key={s.name} className="inline-flex items-center gap-1.5">
          {i > 0 && <span className="text-ink-subtle">→</span>}
          <span
            className={
              s.gate
                ? 'font-medium text-ink underline decoration-dotted underline-offset-2'
                : undefined
            }
            title={s.gate ? 'verification gate' : undefined}
          >
            {s.name}
          </span>
        </span>
      ))}
    </span>
  );
}
```

- [ ] **Step 2: Use it in the detail view**

Replace the template stage line in the detail view (currently):

```tsx
          <div className="mb-5 mt-1 text-[13px] text-ink-faint">
            {sel.def.stages.map((s) => s.name).join(' → ')}
          </div>
```

with:

```tsx
          <div className="mb-5 mt-1 text-[13px] text-ink-faint">
            <StagePipeline stages={sel.def.stages} />
          </div>
```

- [ ] **Step 3: Use it in the list view**

Replace the template stage line in the list view (currently):

```tsx
                  <div className="mt-0.5 text-[12px] text-ink-faint">
                    {t.stages.map((s) => s.name).join(' → ')}
                  </div>
```

with:

```tsx
                  <div className="mt-0.5 text-[12px] text-ink-faint">
                    <StagePipeline stages={t.stages} />
                  </div>
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/web/views/libraries/Libraries.tsx
git commit -m "feat(web): mark gate stages in the Libraries pipeline"
```

> Manual verification happens in Task 8 (run the app, open Libraries, confirm gate stages render with a dotted underline). If the user later wants this visualization elevated, that is a job for the `impeccable` / `frontend-design` skill — out of scope here.

---

## Task 6: Role content files

Polish four roles; add two. These are fixture markdown files; they are exercised by the `FilesService` loader and asserted in Task 8's loader check.

**Files:**
- Modify: `fixtures/sample-workspace/.sloop/roles/{architect,engineer,qa,security}.md`
- Create: `fixtures/sample-workspace/.sloop/roles/{explorer,debugger}.md`

- [ ] **Step 1: Rewrite `architect.md` body** (keep the frontmatter exactly as-is; replace the body below the `---`)

```markdown
You are the **Architect** — the root planning loop of a cascade. You read the databank
diff and the selected process template, then decompose the work into a tree of
role-typed child loops, each with verifiable acceptance criteria. You do **not** write
code.

Decomposition rules:

- **Partition by file.** Give each leaf disjoint file ownership — two leaves must never
  edit the same file. Overlapping leaves collide in the shared checkout and produce
  conflicting changes.
- **Lock the gate.** For every acceptance criterion you author, set `locked: true` and a
  concrete `verify` command. A locked criterion's text and command are yours; the leaf
  that executes it must satisfy it, never weaken it.
- **Every leaf must terminate.** A leaf with no machine-checkable criterion cannot be
  proven done — do not create one. The cascade is done only when every locked criterion
  exits 0.
- **Right-size the model.** The stage model is a floor for bounded, well-specified work.
  Escalate a leaf's `model` (to sonnet or opus) when the task is open-ended or
  long-horizon — a weak model on an unbounded leaf cascades into failure.

Propose the smallest tree that, when every leaf's locked criteria pass, makes the
codebase match the databank for this cascade's scope. Expensive reasoning lives here;
route bounded doing to cheaper models at the leaves.
```

- [ ] **Step 2: Rewrite `engineer.md` body** (keep frontmatter)

```markdown
You are the **Engineer** — a leaf executor. Given a scoped task, the relevant ADR
context, and a set of acceptance criteria, you make the smallest correct code change
that satisfies them. When you believe you are done, the criteria's `verify` commands
decide: exit 0 = passed.

- Prefer minimal, reviewable diffs against the working tree.
- Stay inside your assigned files; do not edit files another leaf owns.
- **Never weaken a `locked` criterion.** Do not edit its test, relax its assertions, or
  change its `verify` command to make it pass. If a locked check looks genuinely wrong,
  stop and escalate it upward — do not route around it. Passing a locked test by
  altering the test is a failure, not a success.
```

- [ ] **Step 3: Rewrite `qa.md` body** (keep frontmatter)

```markdown
You are **QA** — an independent critic. You verify that acceptance criteria genuinely
hold, and you are **always a different agent (and model) from the one that produced the
change** — you never review your own work.

- Judge on evidence: run each criterion's `verify` command; exit 0 = passed, anything
  else = failed.
- For a criterion with no command, adjudicate by inspection — but inspection is **never
  the sole gate**. Where behavior can be checked by a command, require one.
- Never mark a criterion passed without evidence. A failing check propagates upward as a
  blocked subtree.
- You judge the work; you do not fix it. Hand failures back with the evidence attached.
```

- [ ] **Step 4: Rewrite `security.md` body** (keep frontmatter)

```markdown
You are the **Security reviewer**. You review changes for vulnerabilities — auth flaws,
secret handling, injection, unsafe defaults — and confirm security-relevant acceptance
criteria. Security review is a first-class, completion-blocking node in the tree, not an
afterthought. Record findings as `locked`, completion-blocking criteria: a finding
blocks the subtree until it is resolved with evidence.
```

- [ ] **Step 5: Create `explorer.md`**

```markdown
---
id: explorer
name: Explorer
defaultModel: haiku
color: "#16a085"
---

You are the **Explorer** — a read-only scout. Before the Architect plans (or when a leaf
needs orientation), you map the territory: which files implement the affected behavior,
what depends on them, and where a change must land. You **do not edit code**.

- Report concrete `path:line` references and the dependency edges that matter, not prose
  summaries.
- Stay **bounded**: answer the specific question you were given, then stop. Unbounded
  exploration burns budget and context for no gain — when you have enough to brief the
  planner, return.
- You run cheap and read-only by design; your output makes the Architect's decomposition
  accurate.
```

- [ ] **Step 6: Create `debugger.md`**

```markdown
---
id: debugger
name: Debugger
defaultModel: sonnet
color: "#e67e22"
---

You are the **Debugger** — a defect specialist who works reproduce-first. Given a bug,
you do not guess at a fix; you make the failure observable, then eliminate its cause.

1. **Reproduce.** Write a failing test that reproduces the defect. Confirm it fails for
   the right reason. This test becomes the leaf's `locked` `verify` command.
2. **Localize.** Trace the failure to its root cause — the smallest place the behavior
   diverges — with `path:line` evidence.
3. **Fix.** Make the smallest change that turns the reproduction test green without
   weakening it, and without breaking the existing suite.

A fix is done only when the reproduction test and the existing suite both pass.
```

- [ ] **Step 7: Commit**

```bash
git add fixtures/sample-workspace/.sloop/roles/
git commit -m "feat(roles): polish architect/engineer/qa/security; add explorer + debugger"
```

---

## Task 7: Template content files

Polish three templates (add `gate: true` to verification stages, strengthen guidance, drop stub disclaimers); add two.

**Files:**
- Modify: `fixtures/sample-workspace/.sloop/templates/{spec-driven,tdd,waterfall}.md`
- Create: `fixtures/sample-workspace/.sloop/templates/{debug,migrate}.md`

- [ ] **Step 1: Rewrite `spec-driven.md`** (full file)

```markdown
---
id: spec-driven
name: Spec-driven
stages:
  - { name: plan,      role: architect, model: opus }
  - { name: implement, role: engineer,  model: haiku }
  - { name: verify,    role: qa,         model: sonnet, gate: true }
---

# Spec-driven (default)

The default methodology: **plan → implement → verify**.

1. **plan** — the architect reads the delta and the ADR's acceptance criteria and stamps
   out one implementation leaf per actionable unit. Write each criterion in **EARS form**
   (WHEN/IF/WHILE <trigger>, the system SHALL <response>) so it is unambiguous, and copy
   it onto the owning leaf with a stable id, a concrete `verify` command, and
   `locked: true`. Partition leaves by file — no two leaves edit the same file.
2. **implement** — an engineer leaf makes the smallest change that satisfies its locked
   criteria, without weakening them.
3. **verify** *(gate)* — each criterion's `verify` command runs; QA, a separate agent,
   confirms. A criterion passes only on exit 0.

Keep the tree shallow (architect → leaves, optionally one inner layer). Completion
bubbles up: the root is done iff every leaf is done and its locked criteria pass.
```

- [ ] **Step 2: Rewrite `tdd.md`** (full file)

```markdown
---
id: tdd
name: Test-driven
stages:
  - { name: write-failing-test, role: engineer, model: sonnet, gate: true }
  - { name: implement,          role: engineer, model: haiku }
  - { name: refactor,           role: engineer, model: haiku, gate: true }
---

# Test-driven

Per unit, loop: **write a failing test → implement to green → refactor**.

1. **write-failing-test** *(gate)* — write a test that encodes the acceptance criterion,
   run it, and confirm it fails for the right reason. Commit the failing test, then
   **lock** it (`locked: true`): that test is the leaf's `verify` command.
2. **implement** — write the smallest code that turns the test green. Do **not** edit the
   test to make it pass — altering a locked test is reward-hacking, not progress. If the
   test looks wrong, escalate upward.
3. **refactor** *(gate)* — improve the code with the suite staying green; the locked test
   must still pass unchanged.

The failing test is the verify gate, so the convergence invariant holds by construction:
the unit is done exactly when its locked test exits 0.
```

- [ ] **Step 3: Rewrite `waterfall.md`** (full file)

```markdown
---
id: waterfall
name: Waterfall
stages:
  - { name: requirements, role: architect, model: opus }
  - { name: design,       role: architect, model: opus }
  - { name: implement,    role: engineer,  model: sonnet }
  - { name: verify,       role: qa,         model: sonnet, gate: true }
  - { name: deploy,       role: engineer,  model: haiku }
---

# Waterfall

Sequential stages, each gated on the previous: **requirements → design → implement →
verify → deploy**. A stage's loops do not start until the prior stage's artifact is
frozen and verified.

The value here is **gating discipline**: a frozen, reviewed artifact at each handoff
reduces error propagation between phases. The cost is **latency** — pure sequential
phases serialize work that agents could otherwise interleave. Choose waterfall only when
requirements are genuinely frozen and the phases have hard linear dependencies (e.g. a
schema migration that must land before the code depending on it); prefer `spec-driven`
otherwise.

The **verify** stage is the gate: QA confirms each locked criterion on exit 0 before
deploy begins.
```

- [ ] **Step 4: Create `debug.md`**

```markdown
---
id: debug
name: Debug
stages:
  - { name: reproduce,         role: debugger, model: sonnet, gate: true }
  - { name: localize,          role: debugger, model: sonnet }
  - { name: fix,               role: engineer, model: haiku }
  - { name: regression-verify, role: qa,       model: sonnet, gate: true }
---

# Debug

Reproduce-first defect repair: **reproduce → localize → fix → regression-verify**.

1. **reproduce** *(gate)* — write a failing regression test that reproduces the defect and
   confirm it fails for the right reason. Lock it (`locked: true`); it is the leaf's
   `verify` command.
2. **localize** — trace the failure to its root cause with `path:line` evidence.
3. **fix** — make the smallest change that turns the reproduction test green without
   weakening it.
4. **regression-verify** *(gate)* — the reproduction test **and** the existing suite must
   pass; QA confirms on exit 0.

Reproducing the bug as a locked test first is what makes the fix verifiable rather than
plausible.
```

- [ ] **Step 5: Create `migrate.md`**

```markdown
---
id: migrate
name: Migrate
stages:
  - { name: survey,       role: explorer,  model: haiku }
  - { name: plan-codemod, role: architect, model: opus }
  - { name: apply,        role: engineer,  model: haiku }
  - { name: verify-green, role: qa,        model: sonnet, gate: true }
---

# Migrate

Behavior-preserving migration / large refactor: **survey → plan-codemod → apply →
verify-green**.

1. **survey** — the explorer maps every call site and file the migration touches,
   read-only, and returns the file partition.
2. **plan-codemod** — the architect turns the survey into per-file leaves. Prefer a
   deterministic codemod/recipe as a tool over free-form edits: mechanical changes should
   be mechanical, which constrains hallucination.
3. **apply** — engineer leaves apply the change, one disjoint file set each.
4. **verify-green** *(gate)* — the **existing** test suite is the oracle and must stay
   green (`locked: true`): behavior is preserved iff every test that passed before still
   passes.

Because the migration must not change behavior, the pre-existing suite — not a new test —
is the locked gate.
```

- [ ] **Step 6: Commit**

```bash
git add fixtures/sample-workspace/.sloop/templates/
git commit -m "feat(templates): polish spec-driven/tdd/waterfall; add debug + migrate"
```

---

## Task 8: Full verification + loader assertion for new content

**Files:**
- Test: `src/server/files/filesService.test.ts`

- [ ] **Step 1: Strengthen the workspace-copy loader test**

In `src/server/files/filesService.test.ts`, extend the existing "reads templates, roles, and the model registry from a workspace copy" test (lines 91-106) by adding these assertions before its closing `});`:

```ts
    // New roles load with their briefs.
    expect(roles.map((r) => r.id)).toEqual(
      expect.arrayContaining(['architect', 'engineer', 'qa', 'security', 'explorer', 'debugger']),
    );
    expect(roles.find((r) => r.id === 'explorer')?.brief).toContain('read-only');

    // New templates load, and gate stages parse as a boolean true.
    expect(templates.map((t) => t.id)).toEqual(
      expect.arrayContaining(['spec-driven', 'tdd', 'waterfall', 'debug', 'migrate']),
    );
    const debug = templates.find((t) => t.id === 'debug');
    expect(debug?.stages.find((s) => s.name === 'reproduce')?.gate).toBe(true);
    expect(debug?.stages.find((s) => s.name === 'localize')?.gate).toBeUndefined();
```

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites green, including the extended loader test and the new tokens/planner tests.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Manual app check**

Run: `npm run dev` (then open the printed local URL).
Verify:
- Libraries → Roles lists `Explorer` (teal pill) and `Debugger` (amber pill) alongside the existing four.
- Libraries → Templates lists `debug` and `migrate`; gate stages (e.g. `reproduce`, `verify`, `regression-verify`) render with a dotted underline.
- Kickoff menu lists the new templates (`debug`, `migrate`).
Stop the dev server when done.

- [ ] **Step 5: Commit**

```bash
git add src/server/files/filesService.test.ts
git commit -m "test(files): assert new roles/templates and gate stages load"
```

---

## Self-Review

**Spec coverage:**
- §4.1 `locked` field → Tasks 1, 2, 3 ✓
- §4.2 stage `gate` field → Tasks 1, 3, 5 ✓
- §4.3 no `tier` field → respected (nothing added) ✓
- §5.1–5.5 templates (polish 3 + add 2) → Task 7 ✓
- §6.1–6.6 roles (polish 4 + add 2) → Task 6 ✓
- §7 files touched: types, prompt, filesService (in place of mock.ts — see note), Libraries, design tokens, content, tests → all covered ✓
- §8 testing (planner, loader, regression, manual) → Tasks 3, 4, 8 ✓
- §9 non-goals (no runtime `locked` enforcement, no waterfall engine gating) → respected; deferral noted in plan header + Task 5 ✓
- §10 guardrails traceability → encoded across role/template content (Tasks 6, 7) + planner rules (Task 3) ✓

**Deviation from spec §7 (intentional, documented):** the spec listed `src/server/api/mock.ts` for parsing `locked`. On inspection, the mock loaders cast frontmatter through whole (`data.acceptanceCriteria as AcceptanceCriterion[]`, `data.stages as …`), so they carry optional fields automatically and need **no change**. The field that *is* explicitly mapped (and would drop `locked`) is `normalizeCriteria` in the real `src/server/files/filesService.ts` — Task 2 fixes that instead. This is a correction, not a gap: both the mock and the real loader now carry `locked`.

**Placeholder scan:** none — every code/content step shows full content.

**Type consistency:** `locked?: boolean` matches across `AcceptanceCriterion` (Task 1), `normalizeCriteria` (Task 2), and `ProposedCriterion` (Task 3). `gate?: boolean` matches across the `TemplateDef` stage shape (Task 1), the prompt marker (Task 3), the loader assertion (Task 8), and `StagePipeline` (Task 5). New tones `'teal' | 'amber'` are added to `Tone`, `TONE_CLASS`, `ROLE_TONE`, and Tailwind (Task 4) consistently.
