# Merged sloop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port `dev-rens`'s execution-loop strengths (retry-with-evidence, output-glob sandboxing, in-workspace code target) onto the `dev-jelle` base so the two versions converge into one product.

**Architecture:** One workspace repo — `databank/` (ADRs = desired state) + `code/` (converged target, replacing the external `SLOOP_TARGET_REPO`). The cascade diffs `databank/`, the architect plans an editable tree of leaves (each with `allowedOutputs` globs), a human approves at the checkpoint, then each leaf runs through a retry-with-evidence loop: the Pi agent writes into `code/`, out-of-bounds writes are rejected, `verify` commands run, and on failure the evidence is fed back into the next attempt. Convergence bubbles status up to the root.

**Tech Stack:** TypeScript, Node, Vitest, `simple-git`, `@earendil-works/pi-*`, `gray-matter`.

**Execution model:** Task 0 (Foundation) is a hard barrier — every stream depends on the seams and shared types it lands. After it, Tasks 1/2/3 are independent and run as parallel coding agents **in isolated git worktrees** (parallel agents sharing one checkout collide on HEAD/branch). Task 4 integrates and verifies end-to-end. File ownership is disjoint by design:

| Task | Owns (edits) |
|------|--------------|
| 0 Foundation | `src/shared/types.ts`, `src/server/executor/piExecutor.ts`, new seam files (stubs) |
| 1 Target model | `src/server/executor/attempt.ts`, `src/server/files/filesService.ts` (ensure `code/`), `assets/init-template/` |
| 2 Sandboxing | `src/server/executor/sandbox.ts`, `src/server/planner/prompt.ts`, `src/server/cascade/cascadeEngine.ts` (buildLoops only) |
| 3 Retry-with-evidence | `src/server/executor/retry.ts` |
| 4 Integration | `src/server/executor/piExecutor.ts` (wire real values), end-to-end test |

After Task 0, no two parallel tasks edit the same file.

---

## Task 0: Foundation — shared types + executor seam extraction (BARRIER)

Lands the contract every stream builds on, and refactors the executor into three injectable seams **without changing behavior** (existing tests stay green). Ships stub implementations so the suite is green at every step.

**Files:**
- Modify: `src/shared/types.ts` (add `allowedOutputs` to `LoopFrontmatter`)
- Create: `src/server/executor/sandbox.ts` (stub `validateOutputs`)
- Create: `src/server/executor/sandbox.test.ts`
- Create: `src/server/executor/attempt.ts` (extract `buildBrief` + agent run into `executeAttempt`)
- Create: `src/server/executor/retry.ts` (stub `runLeafWithRetry` = 1 attempt)
- Create: `src/server/executor/retry.test.ts`
- Modify: `src/server/executor/piExecutor.ts` (compose the seams)
- Modify: `src/server/executor/index.ts` (re-export new seams)

- [ ] **Step 1: Add `allowedOutputs` to the loop contract**

In `src/shared/types.ts`, inside `interface LoopFrontmatter`, add the field after `acceptanceCriteria`:

```typescript
  acceptanceCriteria: AcceptanceCriterion[];
  /**
   * Glob patterns (repo-root-relative) this leaf is allowed to write. Enforced by
   * the executor: any file the agent writes outside these globs is a violation and
   * triggers a retry. Absent/empty = unrestricted (legacy loops keep working).
   */
  allowedOutputs?: string[];
  executor?: string;
```

No filesService change is needed: `readLoop` spreads `...data` and `writeLoop` spreads the rest of frontmatter, so the new optional field round-trips automatically (and `serializeFrontmatter` prunes it when undefined).

- [ ] **Step 2: Write the failing test for the sandbox stub contract**

Create `src/server/executor/sandbox.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validateOutputs } from './sandbox';

describe('validateOutputs (foundation stub)', () => {
  it('returns no violations when there is no allow-list (legacy loops unrestricted)', () => {
    expect(validateOutputs(['code/a.ts', 'anywhere.ts'], undefined)).toEqual([]);
    expect(validateOutputs(['code/a.ts'], [])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/server/executor/sandbox.test.ts`
Expected: FAIL — `Cannot find module './sandbox'`.

- [ ] **Step 4: Create the sandbox stub**

Create `src/server/executor/sandbox.ts`:

```typescript
/**
 * Output-glob sandbox. Given the files an agent wrote and the leaf's `allowedOutputs`
 * globs, return the files that fall OUTSIDE the allow-list (the violations).
 *
 * FOUNDATION STUB: returns no violations. Task 2 (Sandboxing) implements real glob
 * matching. The empty/undefined allow-list semantics (= unrestricted) are final and
 * must be preserved: legacy leaves carry no `allowedOutputs` and must keep running.
 */
export function validateOutputs(writtenFiles: string[], allowedOutputs: string[] | undefined): string[] {
  if (!allowedOutputs || allowedOutputs.length === 0) return [];
  return []; // TODO(Task 2): real matching
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/server/executor/sandbox.test.ts`
Expected: PASS.

- [ ] **Step 6: Extract the attempt seam from `piExecutor.ts`**

Create `src/server/executor/attempt.ts`. Move `buildBrief` and the agent-run logic here, and expose an `executeAttempt` closure factory. `buildBrief` gains an optional `priorEvidence` parameter (used later by the retry loop; harmless now).

```typescript
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  createAgentSession,
} from '@earendil-works/pi-coding-agent';
import type { LoopDoc, ResolvedModel } from '../../shared/types';
import { buildModel } from './piExecutor';
import { validateOutputs } from './sandbox';

/** One attempt's outcome: what the agent wrote and which writes were out of bounds. */
export interface AttemptResult {
  writtenFiles: string[];
  violations: string[];
}

/** Runs the Pi agent for one attempt. Foundation: no file capture yet (writtenFiles=[]). */
export type ExecuteAttempt = (loop: LoopDoc, opts: { priorEvidence: string[] }) => Promise<AttemptResult>;

/**
 * Compose the brief handed to the Pi agent: the leaf body, its acceptance criteria,
 * and (on retries) the evidence from prior failed attempts so the agent can correct.
 */
export function buildBrief(loop: LoopDoc, priorEvidence: string[] = []): string {
  const { acceptanceCriteria, allowedOutputs } = loop.frontmatter;
  const sections = [loop.body.trim()];

  if (acceptanceCriteria.length > 0) {
    const lines = acceptanceCriteria.map((c) => {
      const verifyNote = c.verify ? `  (verified by: \`${c.verify}\`)` : '';
      return `- ${c.text}${verifyNote}`;
    });
    sections.push(
      `## Acceptance criteria\n\nYour work is done when all of these hold:\n${lines.join('\n')}`,
    );
  }

  if (allowedOutputs && allowedOutputs.length > 0) {
    sections.push(
      `## Allowed outputs\n\nYou may ONLY create or edit files matching these globs:\n` +
        allowedOutputs.map((g) => `- \`${g}\``).join('\n'),
    );
  }

  if (priorEvidence.length > 0) {
    sections.push(
      `## Previous attempt failed\n\nThe last attempt did not pass. Evidence:\n\n` +
        priorEvidence.join('\n\n') +
        `\n\nFix the cause and try again.`,
    );
  }

  sections.push(
    'Make the necessary changes to the codebase in this working directory. ' +
      'When finished, stop — the acceptance criteria will be checked automatically.',
  );

  return sections.filter(Boolean).join('\n\n');
}

export interface AttemptDeps {
  resolved: ResolvedModel;
  cwd: string;
  timeoutMs: number;
  onOutput: (chunk: string) => void;
}

/** Run the Pi coding agent for one attempt. (Moved verbatim from piExecutor.runPiAgent.) */
export async function runPiAgentOnce(loop: LoopDoc, deps: AttemptDeps, priorEvidence: string[]): Promise<void> {
  const authStorage = AuthStorage.inMemory();
  authStorage.setRuntimeApiKey(deps.resolved.provider, deps.resolved.apiKey);
  const modelRegistry = ModelRegistry.create(authStorage);
  const model = buildModel(deps.resolved);

  const { session } = await createAgentSession({
    cwd: deps.cwd,
    model,
    authStorage,
    modelRegistry,
    sessionManager: SessionManager.inMemory(),
  });

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    if (event.type === 'message_update') {
      const inner = event.assistantMessageEvent;
      if (inner.type === 'text_delta') deps.onOutput(inner.delta);
    } else if (event.type === 'tool_execution_start') {
      deps.onOutput(`\n[tool] ${event.toolName}\n`);
    }
  });

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      void session.abort().finally(resolve);
    }, deps.timeoutMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });

  try {
    await Promise.race([session.prompt(buildBrief(loop, priorEvidence)), timeout]);
    if (timedOut) deps.onOutput(`\n[sloop] agent exceeded ${deps.timeoutMs}ms timeout — aborted.\n`);
  } finally {
    if (timer) clearTimeout(timer);
    unsubscribe();
  }
}

/**
 * Build the per-leaf attempt runner. FOUNDATION: runs the agent (or skips in dry-run)
 * and returns no captured writes. Task 1 implements file capture; Task 2's
 * `validateOutputs` then turns captured writes into violations.
 */
export function makeExecuteAttempt(ctx: {
  resolveAttemptDeps: (loop: LoopDoc) => AttemptDeps | null; // null = dry-run (skip agent)
}): ExecuteAttempt {
  return async (loop, { priorEvidence }) => {
    const deps = ctx.resolveAttemptDeps(loop);
    if (deps) await runPiAgentOnce(loop, deps, priorEvidence);
    const writtenFiles: string[] = []; // TODO(Task 1): capture via git working-tree diff
    const violations = validateOutputs(writtenFiles, loop.frontmatter.allowedOutputs);
    return { writtenFiles, violations };
  };
}
```

- [ ] **Step 7: Write the failing test for the retry stub**

Create `src/server/executor/retry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { runLeafWithRetry } from './retry';
import type { LoopDoc } from '../../shared/types';

function leaf(): LoopDoc {
  return {
    frontmatter: {
      id: 'l1', kind: 'leaf', role: 'engineer', model: 'haiku',
      status: 'executing', children: [], acceptanceCriteria: [],
    },
    body: 'do the thing',
    relPath: 'cascades/c/l1.md',
  };
}

describe('runLeafWithRetry (foundation stub: single attempt)', () => {
  it('runs one attempt and reports the verify result', async () => {
    let attempts = 0;
    const res = await runLeafWithRetry(leaf(), {
      executeAttempt: async () => { attempts += 1; return { writtenFiles: [], violations: [] }; },
      verify: async () => true,
      maxAttempts: 3,
    });
    expect(attempts).toBe(1);
    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(1);
  });
});
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `npx vitest run src/server/executor/retry.test.ts`
Expected: FAIL — `Cannot find module './retry'`.

- [ ] **Step 9: Create the retry stub (single attempt, no loop yet)**

Create `src/server/executor/retry.ts`:

```typescript
import type { LoopDoc } from '../../shared/types';
import type { ExecuteAttempt } from './attempt';

/** Result of running a leaf to completion (across one or more attempts). */
export interface LeafRunResult {
  ok: boolean;
  attempts: number;
  evidence: string[];
}

export interface RetryDeps {
  executeAttempt: ExecuteAttempt;
  verify: (loop: LoopDoc) => Promise<boolean>;
  maxAttempts: number;
  onOutput?: (chunk: string) => void;
}

/**
 * FOUNDATION STUB: single attempt, no retry — preserves current behavior exactly.
 * Task 3 (Retry-with-evidence) replaces this body with the real attempt loop.
 */
export async function runLeafWithRetry(loop: LoopDoc, deps: RetryDeps): Promise<LeafRunResult> {
  await deps.executeAttempt(loop, { priorEvidence: [] });
  const ok = await deps.verify(loop);
  return { ok, attempts: 1, evidence: [] };
}
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `npx vitest run src/server/executor/retry.test.ts`
Expected: PASS.

- [ ] **Step 11: Rewire `createExecutor` to compose the seams**

In `src/server/executor/piExecutor.ts`: keep `buildModel`, `isDryRun`, `resolveTargetRepo`, `resolveExecutorTimeoutMs`, `verifyCriteria`, and `ResolveLeafModel`. Remove the now-moved `buildBrief` and `runPiAgent` (they live in `attempt.ts`). Replace `createExecutor` with:

```typescript
import { makeExecuteAttempt, type AttemptDeps } from './attempt';
import { runLeafWithRetry } from './retry';

export function resolveMaxAttempts(env: NodeJS.ProcessEnv): number {
  const parsed = Number.parseInt(env.SLOOP_MAX_ATTEMPTS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

export function createExecutor(resolveLeafModel: ResolveLeafModel): Executor {
  return {
    async run(loop, onOutput) {
      const env = process.env;
      const cwd = resolveTargetRepo(env);
      const dry = isDryRun(env);
      if (dry) onOutput('[sloop] SLOOP_DRY_RUN — skipping Pi agent, running verify only.\n');

      const executeAttempt = makeExecuteAttempt({
        resolveAttemptDeps: (l): AttemptDeps | null => {
          if (dry) return null;
          // Lazy: a missing key throws here -> leaf marked blocked, not a boot crash.
          const resolved = resolveLeafModel(l);
          return { resolved, cwd, timeoutMs: resolveExecutorTimeoutMs(env), onOutput };
        },
      });

      const result = await runLeafWithRetry(loop, {
        executeAttempt,
        verify: (l) => verifyCriteria(l, cwd, env, onOutput),
        maxAttempts: resolveMaxAttempts(env),
        onOutput,
      });

      return { ok: result.ok };
    },
  };
}
```

Note: `buildBrief` was exported from `piExecutor` and re-exported by `index.ts`. Update `src/server/executor/index.ts` to source it from the new module and expose the new seams:

```typescript
export { createExecutor, buildModel, resolveMaxAttempts, DEFAULT_EXECUTOR_TIMEOUT_MS } from './piExecutor';
export { buildBrief, makeExecuteAttempt } from './attempt';
export type { AttemptResult, ExecuteAttempt, AttemptDeps } from './attempt';
export { runLeafWithRetry } from './retry';
export type { LeafRunResult, RetryDeps } from './retry';
export { validateOutputs } from './sandbox';
export { runVerify, resolveVerifyTimeoutMs, DEFAULT_VERIFY_TIMEOUT_MS } from './verify';
export type { RunVerifyOptions } from './verify';
```

- [ ] **Step 12: Update `piExecutor.test.ts` imports if it imported `buildBrief`**

Run: `grep -n "buildBrief" src/server/executor/piExecutor.test.ts`
If it imports `buildBrief` from `./piExecutor`, change the import to `./attempt`. (Behavior is unchanged; `buildBrief` with one arg still works.)

- [ ] **Step 13: Run the full executor suite + typecheck to confirm no behavior change**

Run: `npx vitest run src/server/executor && npx tsc --noEmit`
Expected: PASS — all pre-existing executor tests green, no type errors. This proves the refactor preserved behavior.

- [ ] **Step 14: Commit**

```bash
git add src/shared/types.ts src/server/executor/
git commit -m "refactor(executor): extract attempt/retry/sandbox seams + allowedOutputs contract

Foundation barrier for the merged-sloop streams. Behavior-preserving:
runLeafWithRetry is a single-attempt passthrough, validateOutputs a no-op stub.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 1: Target model — in-workspace `code/` (Stream 1, parallel)

Replace the external `SLOOP_TARGET_REPO` with the workspace itself, ensure a `code/` directory exists, and capture which files an attempt wrote (so the sandbox can check them). The cascade already diffs `databank/` (`gitService.diffDatabank`), so no git-diff change is needed.

**Files:**
- Modify: `src/server/executor/attempt.ts` (file capture + ensure `code/`)
- Create: `src/server/executor/captureWrites.ts` (pure path-set diff + git plumbing)
- Create: `src/server/executor/captureWrites.test.ts`
- Modify: `assets/init-template/` (add a `code/.gitkeep`)

- [ ] **Step 1: Write the failing test for the pure path-set diff**

Create `src/server/executor/captureWrites.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { diffPathSets, SLOOP_OWN_PREFIXES } from './captureWrites';

describe('diffPathSets', () => {
  it('returns paths present after but not before', () => {
    const before = new Set(['code/a.ts']);
    const after = new Set(['code/a.ts', 'code/b.ts']);
    expect(diffPathSets(before, after)).toEqual(['code/b.ts']);
  });

  it('includes modified paths reported in the after set', () => {
    // git status reports modified files too; both snapshots take the porcelain set,
    // so a file modified during the attempt appears in `after` and not `before`.
    expect(diffPathSets(new Set([]), new Set(['code/x.ts']))).toEqual(['code/x.ts']);
  });

  it("excludes sloop's own bookkeeping paths", () => {
    const after = new Set(['code/a.ts', 'databank/adr-1.md', 'cascades/c/l1.md', '.sloop/config.md']);
    expect(diffPathSets(new Set(), after)).toEqual(['code/a.ts']);
  });

  it('exposes the excluded prefixes for reuse', () => {
    expect(SLOOP_OWN_PREFIXES).toContain('databank/');
    expect(SLOOP_OWN_PREFIXES).toContain('cascades/');
    expect(SLOOP_OWN_PREFIXES).toContain('.sloop/');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/executor/captureWrites.test.ts`
Expected: FAIL — `Cannot find module './captureWrites'`.

- [ ] **Step 3: Implement the capture helper**

Create `src/server/executor/captureWrites.ts`:

```typescript
import { simpleGit } from 'simple-git';

/**
 * Paths sloop owns and that an agent leaf is never credited with "writing": the
 * desired-state databank, the cascade bookkeeping, and sloop config. Everything
 * else (notably `code/`) is fair game and subject to the output sandbox.
 */
export const SLOOP_OWN_PREFIXES = ['databank/', 'cascades/', '.sloop/'] as const;

function isOwn(p: string): boolean {
  return SLOOP_OWN_PREFIXES.some((prefix) => p.startsWith(prefix));
}

/** Pure: paths in `after` not in `before`, excluding sloop's own bookkeeping paths. */
export function diffPathSets(before: Set<string>, after: Set<string>): string[] {
  const out: string[] = [];
  for (const p of after) {
    if (!before.has(p) && !isOwn(p)) out.push(p);
  }
  return out.sort();
}

/** Working-tree dirty set via `git status --porcelain` (repo-root-relative paths). */
export async function gitDirtySet(cwd: string): Promise<Set<string>> {
  const git = simpleGit({ baseDir: cwd });
  const status = await git.status();
  return new Set(status.files.map((f) => f.path));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/server/executor/captureWrites.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire capture into `makeExecuteAttempt` and ensure `code/` exists**

In `src/server/executor/attempt.ts`, add imports and replace the foundation `writtenFiles: []` stub. Edit the top imports:

```typescript
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { diffPathSets, gitDirtySet } from './captureWrites';
```

Replace the `makeExecuteAttempt` body so it snapshots before/after and captures writes:

```typescript
export function makeExecuteAttempt(ctx: {
  resolveAttemptDeps: (loop: LoopDoc) => AttemptDeps | null; // null = dry-run (skip agent)
}): ExecuteAttempt {
  return async (loop, { priorEvidence }) => {
    const deps = ctx.resolveAttemptDeps(loop);
    const cwd = deps?.cwd ?? process.cwd();
    await fs.mkdir(path.join(cwd, 'code'), { recursive: true }); // in-workspace target

    const before = await gitDirtySet(cwd);
    if (deps) await runPiAgentOnce(loop, deps, priorEvidence);
    const after = await gitDirtySet(cwd);

    const writtenFiles = diffPathSets(before, after);
    const violations = validateOutputs(writtenFiles, loop.frontmatter.allowedOutputs);
    return { writtenFiles, violations };
  };
}
```

- [ ] **Step 6: Drop `SLOOP_TARGET_REPO` from the executor's resolver**

In `src/server/executor/piExecutor.ts`, change `resolveTargetRepo` so the target is always the workspace root (the cwd), and update its doc comment. The external-repo escape hatch is removed (spec: same-repo only):

```typescript
/** The execution target is the workspace itself; leaves write into its `code/` dir. */
function resolveTargetRepo(_env: NodeJS.ProcessEnv): string {
  return process.cwd();
}
```

Also remove the `SLOOP_TARGET_REPO` line from the `createExecutor` doc-comment's env-var list.

- [ ] **Step 7: Add `code/` to the init scaffold**

Create the file `assets/init-template/code/.gitkeep` with a single comment line so `sloop init` scaffolds the target directory:

```
# sloop builds your code here, reconciled to the databank/.
```

- [ ] **Step 8: Run the executor suite + typecheck**

Run: `npx vitest run src/server/executor && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/server/executor/attempt.ts src/server/executor/captureWrites.ts src/server/executor/captureWrites.test.ts src/server/executor/piExecutor.ts assets/init-template/code/.gitkeep
git commit -m "feat(executor): in-workspace code/ target + write capture

Drops SLOOP_TARGET_REPO; leaves write into the workspace code/ dir, captured via
git working-tree diff for the output sandbox.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Output-glob sandboxing (Stream 2, parallel)

Implement real glob matching in `validateOutputs`, have the architect propose `allowedOutputs` per leaf, and stamp them onto leaf frontmatter.

**Files:**
- Modify: `src/server/executor/sandbox.ts` (real matcher)
- Modify: `src/server/executor/sandbox.test.ts` (real cases)
- Modify: `src/server/planner/prompt.ts` (`ProposedLeaf.allowedOutputs` + prompt + parse)
- Modify: `src/server/cascade/cascadeEngine.ts` (`buildLoops` maps `allowedOutputs`)

- [ ] **Step 1: Expand the sandbox test with real glob cases**

Replace the contents of `src/server/executor/sandbox.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validateOutputs } from './sandbox';

describe('validateOutputs', () => {
  it('is unrestricted when the allow-list is absent or empty', () => {
    expect(validateOutputs(['anything.ts'], undefined)).toEqual([]);
    expect(validateOutputs(['anything.ts'], [])).toEqual([]);
  });

  it('allows files matching a ** glob', () => {
    expect(validateOutputs(['code/a.ts', 'code/sub/b.ts'], ['code/**'])).toEqual([]);
  });

  it('flags files outside the allow-list as violations', () => {
    expect(validateOutputs(['code/a.ts', 'secrets.env'], ['code/**'])).toEqual(['secrets.env']);
  });

  it('supports single-segment * (not crossing /)', () => {
    expect(validateOutputs(['code/a.ts'], ['code/*.ts'])).toEqual([]);
    expect(validateOutputs(['code/sub/a.ts'], ['code/*.ts'])).toEqual(['code/sub/a.ts']);
  });

  it('matches against any of several globs', () => {
    expect(validateOutputs(['code/a.ts', 'tests/a.test.ts'], ['code/**', 'tests/**'])).toEqual([]);
  });

  it('matches exact literal paths', () => {
    expect(validateOutputs(['code/index.ts', 'code/other.ts'], ['code/index.ts'])).toEqual(['code/other.ts']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/server/executor/sandbox.test.ts`
Expected: FAIL — the `**`/`*` cases fail (stub returns `[]` only for empty allow-lists; with an allow-list present it still returns `[]`, so the violation cases fail).

- [ ] **Step 3: Implement the glob matcher**

Replace `src/server/executor/sandbox.ts`:

```typescript
/**
 * Output-glob sandbox. Given the files an agent wrote and the leaf's `allowedOutputs`
 * globs, return the files OUTSIDE the allow-list (the violations).
 *
 * Empty/undefined allow-list = unrestricted (legacy leaves keep running).
 *
 * Glob grammar (POSIX-path, '/'-separated): `**` matches any number of segments
 * (including zero); `*` matches within a single segment; all other characters are
 * literal. This is intentionally minimal — sandbox globs are simple path scopes
 * (`code/**`, `code/*.ts`), not a general fnmatch.
 */
export function validateOutputs(writtenFiles: string[], allowedOutputs: string[] | undefined): string[] {
  if (!allowedOutputs || allowedOutputs.length === 0) return [];
  const matchers = allowedOutputs.map(globToRegExp);
  return writtenFiles.filter((file) => !matchers.some((re) => re.test(file)));
}

/** Compile a minimal glob to an anchored RegExp. */
function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // `**` — any number of path segments (and the optional trailing slash).
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++; // consume the slash after ** so `a/**/b` works
      } else {
        re += '[^/]*'; // `*` — within one segment
      }
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&'); // escape regex metachars
    }
  }
  return new RegExp(`^${re}$`);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/server/executor/sandbox.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the architect carrying `allowedOutputs`**

In `src/server/planner/architect.test.ts` (or `prompt.test.ts` if parse tests live there — check with `grep -n parseArchitectResponse src/server/planner/*.test.ts`), add a test that a parsed leaf preserves `allowedOutputs`:

```typescript
import { parseArchitectResponse } from './prompt';

it('parses allowedOutputs onto each leaf', () => {
  const raw = JSON.stringify({
    summary: 's',
    leaves: [{ id: 'l1', role: 'engineer', model: 'haiku', brief: 'b',
      allowedOutputs: ['code/feature/**'], acceptanceCriteria: [] }],
  });
  const plan = parseArchitectResponse(raw, {
    plannerAlias: 'opus',
    workflow: { id: 'w', name: 'W', steps: [], guidance: '' },
    roles: [],
    maxLeaves: 6,
  });
  expect(plan.leaves[0].allowedOutputs).toEqual(['code/feature/**']);
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx vitest run src/server/planner`
Expected: FAIL — `allowedOutputs` is `undefined` (not yet parsed).

- [ ] **Step 7: Add `allowedOutputs` to `ProposedLeaf`, the prompt, and the parser**

In `src/server/planner/prompt.ts`:

(a) Extend the interface:

```typescript
export interface ProposedLeaf {
  id: string;
  role: string;
  model: string;
  delta?: Delta;
  sourceAdr?: string;
  brief: string;
  allowedOutputs?: string[];
  acceptanceCriteria: ProposedCriterion[];
}
```

(b) In `buildArchitectPrompt`'s system prompt, replace the file-partition rule line with one that asks for globs, and add `allowedOutputs` to the JSON shape. Change the existing rule:

```
'- Partition leaves by file: no two leaves may edit the same file (they share one',
'  checkout and would collide).',
```
to:
```
'- Partition leaves by file. Give each leaf an "allowedOutputs" array of repo-root',
'  relative globs under code/ that it (and only it) may write — e.g. ["code/auth/**"].',
'  No two leaves may share an output path; sandbox violations abort the leaf.',
```

And in the JSON shape block, add the field to the example leaf (after `"brief"`):

```
'      "brief": "what this leaf must do",',
'      "allowedOutputs": ["code/auth/**"],',
```

(c) In `parseArchitectResponse`, inside the `leaves.map(...)`, parse the field (place it next to `sourceAdr`):

```typescript
    const allowedOutputs = Array.isArray(l.allowedOutputs)
      ? l.allowedOutputs.filter((g): g is string => typeof g === 'string' && g.trim().length > 0).map((g) => g.trim())
      : undefined;
```

and add `allowedOutputs,` to the returned object literal.

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run src/server/planner`
Expected: PASS.

- [ ] **Step 9: Write the failing test for `buildLoops` stamping `allowedOutputs`**

In `src/server/cascade/cascadeEngine.test.ts`, add a test (follow the existing fake-planner setup in that file) asserting a proposed leaf's `allowedOutputs` lands on the persisted leaf frontmatter. Use the file's existing helpers for building a fake planner/services; the assertion is:

```typescript
// after kickoff with a planner returning a leaf with allowedOutputs: ['code/x/**']
const written = writtenLoops.find((l) => l.frontmatter.id === 'l1');
expect(written?.frontmatter.allowedOutputs).toEqual(['code/x/**']);
```

(If the existing fake planner returns an `ArchitectPlan`, add `allowedOutputs: ['code/x/**']` to its leaf.)

- [ ] **Step 10: Run the test to verify it fails**

Run: `npx vitest run src/server/cascade/cascadeEngine.test.ts`
Expected: FAIL — `allowedOutputs` is `undefined` on the written loop.

- [ ] **Step 11: Map `allowedOutputs` in `buildLoops`**

In `src/server/cascade/cascadeEngine.ts`, inside `buildLoops`, in the `leaves.map((leaf) => { const fm: LoopFrontmatter = {...} })`, add the field (after `sourceAdr: leaf.sourceAdr,`):

```typescript
        sourceAdr: leaf.sourceAdr,
        allowedOutputs: leaf.allowedOutputs,
        workflow: workflowId,
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `npx vitest run src/server/cascade/cascadeEngine.test.ts`
Expected: PASS.

- [ ] **Step 13: Run the broader suite + typecheck**

Run: `npx vitest run src/server/planner src/server/cascade src/server/executor && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 14: Commit**

```bash
git add src/server/executor/sandbox.ts src/server/executor/sandbox.test.ts src/server/planner/prompt.ts src/server/planner/architect.test.ts src/server/cascade/cascadeEngine.ts src/server/cascade/cascadeEngine.test.ts
git commit -m "feat(sandbox): output-glob sandboxing + architect-proposed allowedOutputs

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Retry-with-evidence (Stream 3, parallel)

Replace the single-attempt stub in `retry.ts` with a real loop: on a violation or a failed verify, record evidence, feed it into the next attempt's brief, and retry up to `maxAttempts`; on exhaustion return `ok:false` with evidence preserved.

**Files:**
- Modify: `src/server/executor/retry.ts`
- Modify: `src/server/executor/retry.test.ts`

- [ ] **Step 1: Write the failing tests for the retry behavior**

Replace `src/server/executor/retry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { runLeafWithRetry } from './retry';
import type { LoopDoc } from '../../shared/types';
import type { AttemptResult } from './attempt';

function leaf(): LoopDoc {
  return {
    frontmatter: {
      id: 'l1', kind: 'leaf', role: 'engineer', model: 'haiku',
      status: 'executing', children: [], acceptanceCriteria: [],
    },
    body: 'do the thing',
    relPath: 'cascades/c/l1.md',
  };
}

const clean: AttemptResult = { writtenFiles: ['code/a.ts'], violations: [] };

describe('runLeafWithRetry', () => {
  it('passes on the first attempt when verify succeeds', async () => {
    let n = 0;
    const res = await runLeafWithRetry(leaf(), {
      executeAttempt: async () => { n++; return clean; },
      verify: async () => true,
      maxAttempts: 3,
    });
    expect(res).toEqual({ ok: true, attempts: 1, evidence: [] });
    expect(n).toBe(1);
  });

  it('retries after a failed verify and passes on a later attempt', async () => {
    let n = 0;
    const evidenceSeen: string[][] = [];
    const res = await runLeafWithRetry(leaf(), {
      executeAttempt: async (_l, { priorEvidence }) => { evidenceSeen.push(priorEvidence); n++; return clean; },
      verify: async () => n >= 2, // fail first, pass second
      maxAttempts: 3,
    });
    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(2);
    expect(evidenceSeen[0]).toEqual([]);        // first attempt: no prior evidence
    expect(evidenceSeen[1].length).toBe(1);     // second attempt: fed the failure evidence
  });

  it('retries on a sandbox violation without running verify', async () => {
    let verifyCalls = 0;
    const res = await runLeafWithRetry(leaf(), {
      executeAttempt: async () => ({ writtenFiles: ['evil.sh'], violations: ['evil.sh'] }),
      verify: async () => { verifyCalls++; return true; },
      maxAttempts: 2,
    });
    expect(res.ok).toBe(false);
    expect(res.attempts).toBe(2);
    expect(verifyCalls).toBe(0);                 // violation short-circuits verify
    expect(res.evidence.join('\n')).toContain('evil.sh');
  });

  it('returns ok:false with evidence when attempts are exhausted', async () => {
    const res = await runLeafWithRetry(leaf(), {
      executeAttempt: async () => clean,
      verify: async () => false,
      maxAttempts: 3,
    });
    expect(res.ok).toBe(false);
    expect(res.attempts).toBe(3);
    expect(res.evidence.length).toBe(3);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/server/executor/retry.test.ts`
Expected: FAIL — the stub does one attempt and never retries.

- [ ] **Step 3: Implement the retry loop**

Replace the `runLeafWithRetry` body in `src/server/executor/retry.ts` (keep the existing types):

```typescript
export async function runLeafWithRetry(loop: LoopDoc, deps: RetryDeps): Promise<LeafRunResult> {
  const evidence: string[] = [];

  for (let attempt = 1; attempt <= deps.maxAttempts; attempt++) {
    deps.onOutput?.(`\n[attempt ${attempt}/${deps.maxAttempts}] ${loop.frontmatter.id}\n`);
    const { violations } = await deps.executeAttempt(loop, { priorEvidence: [...evidence] });

    if (violations.length > 0) {
      const note = `Attempt ${attempt}: wrote files outside allowedOutputs: ${violations.join(', ')}.`;
      deps.onOutput?.(`[sandbox] ${note}\n`);
      evidence.push(note);
      continue; // out-of-bounds writes are a failure; don't even run verify
    }

    const ok = await deps.verify(loop);
    if (ok) return { ok: true, attempts: attempt, evidence };
    evidence.push(`Attempt ${attempt}: acceptance criteria did not pass (see verify output above).`);
  }

  return { ok: false, attempts: deps.maxAttempts, evidence };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/server/executor/retry.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the executor suite + typecheck**

Run: `npx vitest run src/server/executor && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/executor/retry.ts src/server/executor/retry.test.ts
git commit -m "feat(executor): retry-with-evidence loop

On a sandbox violation or failed verify, record evidence, feed it into the next
attempt's brief, retry up to maxAttempts; preserve evidence on exhaustion.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Integration — wire seams end-to-end (after streams merge)

Merge the three stream worktrees back, confirm the seams compose, and prove the whole loop with a dry-run cascade. By now `createExecutor` (from Task 0) already calls the real `executeAttempt` (Task 1), the real `validateOutputs` (Task 2), and the real `runLeafWithRetry` (Task 3) — this task verifies they compose and closes any gaps.

**Files:**
- Create: `src/server/executor/executor.integration.test.ts`
- Modify: `src/server/executor/piExecutor.ts` (only if a wiring gap is found)

- [ ] **Step 1: Merge the stream branches**

For each stream worktree branch, merge into the integration branch:

```bash
git merge --no-ff stream-1-target-model stream-2-sandboxing stream-3-retry
```

Resolve conflicts (there should be none — file ownership is disjoint after Task 0). Then:

Run: `npx tsc --noEmit`
Expected: PASS — all seams type-check together.

- [ ] **Step 2: Write the failing end-to-end attempt test (dry-run, real seams)**

Create `src/server/executor/executor.integration.test.ts`. This exercises `runLeafWithRetry` with the real `validateOutputs` and a fake `executeAttempt` that simulates the agent writing one in-bounds then one out-of-bounds file, to prove the composed contract:

```typescript
import { describe, it, expect } from 'vitest';
import { runLeafWithRetry } from './retry';
import { validateOutputs } from './sandbox';
import type { LoopDoc } from '../../shared/types';

function leaf(allowedOutputs: string[]): LoopDoc {
  return {
    frontmatter: {
      id: 'l1', kind: 'leaf', role: 'engineer', model: 'haiku',
      status: 'executing', children: [], acceptanceCriteria: [], allowedOutputs,
    },
    body: 'build the feature',
    relPath: 'cascades/c/l1.md',
  };
}

describe('executor seams compose', () => {
  it('rejects an out-of-bounds attempt, then accepts an in-bounds one', async () => {
    const writes = [['code/ok.ts', 'rogue.ts'], ['code/ok.ts']]; // attempt 1 strays, attempt 2 complies
    let i = 0;
    const res = await runLeafWithRetry(leaf(['code/**']), {
      executeAttempt: async (l) => {
        const written = writes[i++];
        return { writtenFiles: written, violations: validateOutputs(written, l.frontmatter.allowedOutputs) };
      },
      verify: async () => true,
      maxAttempts: 3,
    });
    expect(res.ok).toBe(true);
    expect(res.attempts).toBe(2);
    expect(res.evidence[0]).toContain('rogue.ts');
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run src/server/executor/executor.integration.test.ts`
Expected: PASS (the seams already compose). If it fails, fix the wiring in `piExecutor.ts` / `attempt.ts` until it passes — do not weaken the test.

- [ ] **Step 4: Run the FULL suite + typecheck + build**

Run: `npx vitest run && npx tsc --noEmit && npm run build`
Expected: PASS — entire suite green, no type errors, build succeeds.

- [ ] **Step 5: Manual dry-run smoke (optional but recommended)**

In a scratch workspace produced by `sloop init`, edit a `databank/` ADR, then run a cascade with `SLOOP_DRY_RUN=1`. Confirm: a `code/` dir exists, the cascade reaches the approval checkpoint, approval runs leaves verify-only, and the root converges or blocks honestly with visible evidence.

- [ ] **Step 6: Commit**

```bash
git add src/server/executor/executor.integration.test.ts src/server/executor/piExecutor.ts
git commit -m "test(executor): end-to-end seam composition for merged-sloop

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** retry-with-evidence → Task 3; output-glob sandboxing → Task 2; in-workspace `code/` → Task 1; shared `allowedOutputs` + executor result with `attempts`/`evidence` → Task 0 (`LeafRunResult`) + Task 3; editable generated tree, Mission Control UI, convergence bubble-up → unchanged from `dev-jelle` (no task needed). Out-of-scope items in the spec (paper UI, pluggable strategy, alternatives, external target repo) intentionally have no tasks.
- **Type consistency:** `AttemptResult { writtenFiles, violations }`, `ExecuteAttempt (loop, { priorEvidence }) => Promise<AttemptResult>`, `LeafRunResult { ok, attempts, evidence }`, `RetryDeps { executeAttempt, verify, maxAttempts, onOutput? }`, `validateOutputs(writtenFiles, allowedOutputs?) => string[]` are used identically across Tasks 0–4.
- **Empty allow-list = unrestricted** is fixed in Task 0 and relied on by Task 2 — legacy leaves with no `allowedOutputs` keep running.
- **Evidence** lives on the executor result (`LeafRunResult`) and is streamed via `onOutput`; the cascade engine's `Executor.run` still returns `{ ok }`, so no `cascadeEngine.applyVerdict` change is required.
