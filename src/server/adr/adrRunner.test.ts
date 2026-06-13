import { describe, it, expect } from 'vitest';
import type { AdrDoc, AdrRunEvent, Executor, LoopDoc, RoleDef, WorkflowDef } from '../../shared/index';
import type { RunHistoryEntry } from '../../shared/index';
import {
  createAdrRunner,
  planRunSet,
  selectAdrRun,
  buildSyntheticLoop,
  buildRunPreamble,
  Conflict,
} from './adrRunner';

/** Build a minimal AdrDoc with sane defaults for the new executable fields. */
function adr(partial: Partial<AdrDoc> & { id: string; relPath: string }): AdrDoc {
  return {
    title: partial.id,
    body: `body of ${partial.id}`,
    acceptanceCriteria: [],
    children: [],
    status: 'idle',
    outputs: [],
    ...partial,
  };
}

describe('planRunSet', () => {
  it('returns just the source when it has no children', () => {
    const adrs = [adr({ id: 'a', relPath: 'loops/a.md' })];
    expect(planRunSet(adrs, 'loops/a.md')).toEqual(['loops/a.md']);
  });

  it('walks nested descendants depth-first in children order', () => {
    const adrs = [
      adr({ id: 'root', relPath: 'loops/root.md', children: ['loops/b.md', 'loops/c.md'] }),
      adr({ id: 'b', relPath: 'loops/b.md', children: ['loops/d.md'] }),
      adr({ id: 'c', relPath: 'loops/c.md' }),
      adr({ id: 'd', relPath: 'loops/d.md' }),
    ];
    expect(planRunSet(adrs, 'loops/root.md')).toEqual([
      'loops/root.md',
      'loops/b.md',
      'loops/d.md',
      'loops/c.md',
    ]);
  });

  it('breaks cycles, including each node at most once', () => {
    const adrs = [
      adr({ id: 'a', relPath: 'loops/a.md', children: ['loops/b.md'] }),
      adr({ id: 'b', relPath: 'loops/b.md', children: ['loops/a.md'] }), // back-edge
    ];
    expect(planRunSet(adrs, 'loops/a.md')).toEqual(['loops/a.md', 'loops/b.md']);
  });

  it('skips unknown child relPaths', () => {
    const adrs = [adr({ id: 'a', relPath: 'loops/a.md', children: ['loops/ghost.md', 'loops/b.md'] }), adr({ id: 'b', relPath: 'loops/b.md' })];
    expect(planRunSet(adrs, 'loops/a.md')).toEqual(['loops/a.md', 'loops/b.md']);
  });

  it('returns empty for an unknown source', () => {
    expect(planRunSet([], 'loops/missing.md')).toEqual([]);
  });
});

describe('selectAdrRun', () => {
  const entry = (over: Partial<RunHistoryEntry> & { id: string; runSet: string[] }): RunHistoryEntry => ({
    rootRelPath: over.runSet[0],
    status: 'passed',
    createdAt: '2026-01-01T00:00:00.000Z',
    evidence: [],
    ...over,
  });

  it('prefers the active run when its run-set covers the ADR → live', () => {
    const active = { runId: 'run-active', rootRelPath: 'loops/root.md', runSetPaths: ['loops/root.md', 'loops/leaf.md'] };
    const history = [entry({ id: 'run-old', runSet: ['loops/root.md', 'loops/leaf.md'] })];
    expect(selectAdrRun('loops/leaf.md', active, history)).toEqual({ runId: 'run-active', live: true });
  });

  it('matches on run-set membership, not just the root (child ADR rehydrates live)', () => {
    const active = { runId: 'run-active', rootRelPath: 'loops/root.md', runSetPaths: ['loops/root.md', 'loops/child.md'] };
    expect(selectAdrRun('loops/child.md', active, [])).toEqual({ runId: 'run-active', live: true });
  });

  it('falls back to the newest finished run including the ADR when active does not cover it → not live', () => {
    const active = { runId: 'run-active', rootRelPath: 'loops/other.md', runSetPaths: ['loops/other.md'] };
    const history = [
      entry({ id: 'run-2', runSet: ['loops/x.md'] }), // newest, excludes target
      entry({ id: 'run-1', runSet: ['loops/root.md', 'loops/leaf.md'] }),
    ];
    expect(selectAdrRun('loops/leaf.md', active, history)).toEqual({ runId: 'run-1', live: false });
  });

  it('picks the newest history entry (newest-first) when several included the ADR', () => {
    const history = [
      entry({ id: 'run-new', runSet: ['loops/a.md'] }),
      entry({ id: 'run-old', runSet: ['loops/a.md'] }),
    ];
    expect(selectAdrRun('loops/a.md', null, history)).toEqual({ runId: 'run-new', live: false });
  });

  it('returns null when no active or finished run included the ADR', () => {
    const active = { runId: 'run-active', rootRelPath: 'loops/other.md', runSetPaths: ['loops/other.md'] };
    const history = [entry({ id: 'run-1', runSet: ['loops/x.md'] })];
    expect(selectAdrRun('loops/missing.md', active, history)).toBeNull();
    expect(selectAdrRun('loops/missing.md', null, [])).toBeNull();
  });
});

/** An in-memory FilesService slice the runner depends on. */
function fakeFiles(initial: AdrDoc[], opts?: { workflows?: WorkflowDef[]; roles?: RoleDef[] }) {
  const store = new Map(initial.map((a) => [a.relPath, structuredClone(a)]));
  return {
    store,
    listAdrs: async () => [...store.values()].map((a) => structuredClone(a)),
    readAdr: async (p: string) => {
      const a = store.get(p);
      if (!a) throw new Error(`not found: ${p}`);
      return structuredClone(a);
    },
    writeAdr: async (d: AdrDoc) => {
      store.set(d.relPath, structuredClone(d));
    },
    listWorkflows: async () => opts?.workflows ?? [],
    listRoles: async () => opts?.roles ?? [],
  };
}

/** An executor that flips every synthetic-loop criterion's `.passed` to a fixed verdict. */
function verdictExecutor(verdict: boolean): Executor {
  return {
    async run(loop: LoopDoc, onOutput) {
      onOutput('[fake] running\n');
      for (const c of loop.frontmatter.acceptanceCriteria) c.passed = verdict;
      return { ok: verdict };
    },
  };
}

async function drain(
  runner: ReturnType<typeof createAdrRunner>,
  runId: string,
): Promise<AdrRunEvent[]> {
  const events: AdrRunEvent[] = [];
  await new Promise<void>((resolve) => {
    runner.subscribe(
      runId,
      (e) => events.push(e),
      () => resolve(),
    );
  });
  return events;
}

describe('createAdrRunner', () => {
  const tree = [
    adr({
      id: 'root',
      relPath: 'loops/root.md',
      children: ['loops/leaf.md'],
      acceptanceCriteria: [{ id: 'ac-1', text: 'root works', verify: 'true', passed: false }],
    }),
    adr({
      id: 'leaf',
      relPath: 'loops/leaf.md',
      acceptanceCriteria: [{ id: 'ac-1', text: 'leaf works', verify: 'true', passed: false }],
    }),
  ];

  it('pass path: statuses become passed and the done event reports passed', async () => {
    const files = fakeFiles(tree);
    const runner = createAdrRunner({ files, executor: verdictExecutor(true), env: {} });

    const { runId } = await runner.runAdr('loops/root.md');
    const events = await drain(runner, runId);

    expect(files.store.get('loops/root.md')?.status).toBe('passed');
    expect(files.store.get('loops/leaf.md')?.status).toBe('passed');

    const done = events.find((e) => e.type === 'done');
    expect(done).toMatchObject({ type: 'done', status: 'passed' });

    // eval events de-namespace the criterion id back to its owning ADR's relPath.
    const evals = events.filter((e): e is Extract<AdrRunEvent, { type: 'eval' }> => e.type === 'eval');
    expect(evals).toHaveLength(2);
    expect(evals.every((e) => e.passed)).toBe(true);
    expect(evals.map((e) => e.relPath).sort()).toEqual(['loops/leaf.md', 'loops/root.md']);
    expect(evals.every((e) => e.criterionId === 'ac-1')).toBe(true);

    const entry = await runner.getRun(runId);
    expect(entry.status).toBe('passed');
    expect(entry.runSet).toEqual(['loops/root.md', 'loops/leaf.md']);
    expect(entry.evidence).toEqual([]);
  });

  it('fail path: statuses become failed and evidence is recorded', async () => {
    const files = fakeFiles(tree);
    const runner = createAdrRunner({ files, executor: verdictExecutor(false), env: {} });

    const { runId } = await runner.runAdr('loops/root.md');
    const events = await drain(runner, runId);

    expect(files.store.get('loops/root.md')?.status).toBe('failed');
    expect(files.store.get('loops/leaf.md')?.status).toBe('failed');
    expect(events.find((e) => e.type === 'done')).toMatchObject({ status: 'failed' });

    const entry = await runner.getRun(runId);
    expect(entry.status).toBe('failed');
    expect(entry.evidence.length).toBe(2);
  });

  it('serializes runs: a second concurrent runAdr throws Conflict', async () => {
    const files = fakeFiles(tree);
    // An executor that blocks until released keeps the first run active.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const blockingExecutor: Executor = {
      async run(loop, onOutput) {
        onOutput('[fake] blocked\n');
        await gate;
        for (const c of loop.frontmatter.acceptanceCriteria) c.passed = true;
        return { ok: true };
      },
    };
    const runner = createAdrRunner({ files, executor: blockingExecutor, env: {} });

    const first = await runner.runAdr('loops/root.md');
    await expect(runner.runAdr('loops/leaf.md')).rejects.toBeInstanceOf(Conflict);

    // Release the first run; once it finishes the guard clears and a new run is allowed.
    release();
    await drain(runner, first.runId);
    await expect(runner.runAdr('loops/leaf.md')).resolves.toMatchObject({ runId: expect.any(String) });
  });

  it('getAdrRun: reports the active run as live for any run-set member, null once idle for non-members', async () => {
    const files = fakeFiles(tree);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const blockingExecutor: Executor = {
      async run(loop, onOutput) {
        onOutput('[fake] blocked\n');
        await gate;
        for (const c of loop.frontmatter.acceptanceCriteria) c.passed = true;
        return { ok: true };
      },
    };
    const runner = createAdrRunner({ files, executor: blockingExecutor, env: {} });

    const { runId } = await runner.runAdr('loops/root.md');
    // The active run covers both the root and the descendant pulled into its run-set.
    expect(runner.getAdrRun('loops/root.md')).toEqual({ runId, live: true });
    expect(runner.getAdrRun('loops/leaf.md')).toEqual({ runId, live: true });
    expect(runner.getAdrRun('loops/unrelated.md')).toBeNull();

    release();
    await drain(runner, runId);

    // After completion the finished run rehydrates as a replay (not live) for its members.
    expect(runner.getAdrRun('loops/root.md')).toEqual({ runId, live: false });
    expect(runner.getAdrRun('loops/leaf.md')).toEqual({ runId, live: false });
    expect(runner.getAdrRun('loops/unrelated.md')).toBeNull();
  });

  it('unions outputs into the synthetic loop sandbox only when every ADR opts in', async () => {
    const constrained = [
      adr({ id: 'root', relPath: 'loops/root.md', children: ['loops/leaf.md'], outputs: ['src/a/**'] }),
      adr({ id: 'leaf', relPath: 'loops/leaf.md', outputs: ['src/b/**'] }),
    ];
    let captured: string[] | undefined;
    const spyExecutor: Executor = {
      async run(loop) {
        captured = loop.frontmatter.allowedOutputs;
        return { ok: true };
      },
    };
    const runner = createAdrRunner({ files: fakeFiles(constrained), executor: spyExecutor, env: {} });
    const { runId } = await runner.runAdr('loops/root.md');
    await drain(runner, runId);
    expect(captured?.sort()).toEqual(['src/a/**', 'src/b/**']);

    // If any ADR has no outputs, the sandbox stays unrestricted (undefined).
    let captured2: string[] | undefined = ['sentinel'];
    const spy2: Executor = {
      async run(loop) {
        captured2 = loop.frontmatter.allowedOutputs;
        return { ok: true };
      },
    };
    const mixed = [
      adr({ id: 'root', relPath: 'loops/root.md', children: ['loops/leaf.md'], outputs: ['src/a/**'] }),
      adr({ id: 'leaf', relPath: 'loops/leaf.md' }), // no outputs
    ];
    const runner2 = createAdrRunner({ files: fakeFiles(mixed), executor: spy2, env: {} });
    const r2 = await runner2.runAdr('loops/root.md');
    await drain(runner2, r2.runId);
    expect(captured2).toBeUndefined();
  });
});

describe('buildRunPreamble', () => {
  it('is empty when neither persona nor guidance is present', () => {
    expect(buildRunPreamble(undefined, undefined)).toBe('');
    expect(buildRunPreamble({ name: 'Engineer', brief: '  ' }, { name: 'Ship', guidance: '\n' })).toBe('');
  });

  it('includes the role persona text when a brief is present', () => {
    const out = buildRunPreamble({ name: 'Engineer', brief: 'Write tidy code.' }, undefined);
    expect(out).toContain('You are acting as the "Engineer" role.');
    expect(out).toContain('Write tidy code.');
    expect(out.endsWith('---\n\n')).toBe(true);
  });

  it('includes the workflow guidance text when present', () => {
    const out = buildRunPreamble(undefined, { name: 'Ship It', guidance: 'Small PRs only.' });
    expect(out).toContain('Workflow "Ship It" guidance:');
    expect(out).toContain('Small PRs only.');
  });

  it('orders persona before guidance when both are present', () => {
    const out = buildRunPreamble(
      { name: 'Engineer', brief: 'Write tidy code.' },
      { name: 'Ship It', guidance: 'Small PRs only.' },
    );
    expect(out.indexOf('Engineer')).toBeLessThan(out.indexOf('Ship It'));
  });
});

describe('buildSyntheticLoop preamble', () => {
  const runSet: AdrDoc[] = [
    {
      id: 'root',
      relPath: 'loops/root.md',
      title: 'root',
      body: 'the body of root',
      acceptanceCriteria: [],
      children: [],
      status: 'idle',
      outputs: [],
    },
  ];

  it('prepends role persona and workflow guidance, then the ADR bodies', () => {
    const loop = buildSyntheticLoop(
      'loops/root.md',
      runSet,
      'sonnet',
      { name: 'Engineer', brief: 'Write tidy code.' },
      { name: 'Ship It', guidance: 'Small PRs only.' },
    );
    expect(loop.body).toContain('You are acting as the "Engineer" role.');
    expect(loop.body).toContain('Workflow "Ship It" guidance:');
    expect(loop.body).toContain('## loops/root.md');
    expect(loop.body).toContain('the body of root');
    // Preamble precedes the concatenated ADR bodies.
    expect(loop.body.indexOf('Engineer')).toBeLessThan(loop.body.indexOf('## loops/root.md'));
  });

  it('omits the preamble entirely when no persona/guidance is given (unchanged behavior)', () => {
    const loop = buildSyntheticLoop('loops/root.md', runSet, 'sonnet');
    expect(loop.body).toBe('## loops/root.md\n\nthe body of root');
  });
});
