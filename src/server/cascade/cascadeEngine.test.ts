import { describe, it, expect } from 'vitest';
import type {
  AdrDoc,
  DatabankDiff,
  Executor,
  FilesService,
  GitService,
  LoopDoc,
  ModelRegistry,
  RoleDef,
  TemplateDef,
} from '../../shared/index';
import type { ArchitectInput, ArchitectPlanner } from '../planner/architect';
import type { ArchitectPlan } from '../planner/prompt';
import { createCascadeEngine } from './cascadeEngine';

const TEMPLATE: TemplateDef = {
  id: 'spec-driven',
  name: 'Spec-driven',
  stages: [
    { name: 'plan', role: 'architect', model: 'opus' },
    { name: 'implement', role: 'engineer', model: 'haiku' },
  ],
  guidance: 'plan → implement → verify',
};

const ROLES: RoleDef[] = [
  { id: 'engineer', name: 'Engineer', defaultModel: 'haiku', brief: 'Make the change.' },
];

const REGISTRY: ModelRegistry = {
  models: { opus: { provider: 'anthropic', id: 'claude-opus-4-8' } },
  providers: { anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' } } as ModelRegistry['providers'],
};

const DIFF: DatabankDiff = {
  changed: [
    {
      relPath: 'databank/adr-007-token-rotation.md',
      delta: 'change',
      before: 'a',
      after: 'b',
    },
  ],
};

const PLAN: ArchitectPlan = {
  plannerAlias: 'opus',
  summary: 'Proposed two leaves.',
  leaves: [
    {
      id: 'rotate-refresh-tokens',
      role: 'engineer',
      model: 'haiku',
      delta: 'change',
      sourceAdr: 'adr-007',
      brief: 'Rotate tokens.',
      acceptanceCriteria: [{ id: 'ac-1', text: 'rotate', verify: 'npm test -- rotation' }],
    },
    {
      id: 'invalidate-on-reuse',
      role: 'engineer',
      model: 'haiku',
      delta: 'change',
      sourceAdr: 'adr-007',
      brief: 'Reject reuse.',
      acceptanceCriteria: [{ id: 'ac-2', text: 'revoke', verify: 'npm test -- reuse' }],
    },
  ],
};

/** In-memory FilesService fake — stores loops by relPath, lists by cascade id. */
class FakeFiles implements FilesService {
  readonly loops = new Map<string, LoopDoc>();

  async listAdrs(): Promise<AdrDoc[]> {
    return [];
  }
  async readAdr(): Promise<AdrDoc> {
    throw new Error('not used');
  }
  async writeAdr(): Promise<void> {}
  async moveAdr(): Promise<void> {}
  async readLoop(relPath: string): Promise<LoopDoc> {
    const found = this.loops.get(relPath);
    if (!found) throw new Error(`no loop ${relPath}`);
    return found;
  }
  async writeLoop(loop: LoopDoc): Promise<void> {
    // Store a deep copy so the engine cannot mutate persisted state by reference.
    this.loops.set(loop.relPath, JSON.parse(JSON.stringify(loop)));
  }
  async listLoops(cascadeId: string): Promise<LoopDoc[]> {
    const prefix = `cascades/${cascadeId}/`;
    return [...this.loops.values()]
      .filter((l) => l.relPath.startsWith(prefix))
      .map((l) => JSON.parse(JSON.stringify(l)) as LoopDoc);
  }
  async listCascadeIds(): Promise<string[]> {
    const ids = new Set<string>();
    for (const relPath of this.loops.keys()) {
      const m = /^cascades\/([^/]+)\//.exec(relPath);
      if (m) ids.add(m[1]);
    }
    return [...ids].sort();
  }
  async listTemplates(): Promise<TemplateDef[]> {
    return [TEMPLATE];
  }
  async listRoles(): Promise<RoleDef[]> {
    return ROLES;
  }
  async readModelRegistry(): Promise<ModelRegistry> {
    return REGISTRY;
  }
}

class FakeGit implements GitService {
  async diffDatabank(): Promise<DatabankDiff> {
    return DIFF;
  }
  async commitAll(): Promise<string> {
    return 'deadbee';
  }
}

/** Executor whose verdict per leaf id is scripted; records outputs and call order. */
class FakeExecutor implements Executor {
  readonly ran: string[] = [];
  constructor(private readonly verdicts: Record<string, boolean>) {}
  async run(loop: LoopDoc, onOutput: (chunk: string) => void): Promise<{ ok: boolean }> {
    this.ran.push(loop.frontmatter.id);
    onOutput(`running ${loop.frontmatter.id}\n`);
    return { ok: this.verdicts[loop.frontmatter.id] ?? true };
  }
}

class FakePlanner implements ArchitectPlanner {
  readonly inputs: ArchitectInput[] = [];
  constructor(private readonly plan: ArchitectPlan = PLAN) {}
  async propose(input: ArchitectInput): Promise<ArchitectPlan> {
    this.inputs.push(input);
    return this.plan;
  }
}

function makeEngine(verdicts: Record<string, boolean> = {}) {
  const files = new FakeFiles();
  const git = new FakeGit();
  const executor = new FakeExecutor(verdicts);
  const planner = new FakePlanner();
  const outputs: Array<[string, string]> = [];
  const engine = createCascadeEngine({
    files,
    git,
    executor,
    planner,
    env: { ANTHROPIC_API_KEY: 'k' } as NodeJS.ProcessEnv,
    now: () => '2026-06-13T09:00:00.000Z',
    onOutput: (id, chunk) => outputs.push([id, chunk]),
  });
  return { engine, files, executor, planner, outputs };
}

const CASCADE_ID = '2026-06-13-spec-driven';

function statusOf(loops: LoopDoc[], id: string): string {
  const l = loops.find((x) => x.frontmatter.id === id);
  if (!l) throw new Error(`no loop ${id}`);
  return l.frontmatter.status;
}

describe('CascadeEngine.kickoff', () => {
  it('diffs, runs the architect, and writes an awaiting-approval tree', async () => {
    const { engine, files, planner } = makeEngine();
    const summary = await engine.kickoff('spec-driven');

    expect(summary.id).toBe(CASCADE_ID);
    expect(summary.status).toBe('awaiting_approval');
    expect(summary.template).toBe('spec-driven');
    expect(summary.deltas).toEqual({ add: 0, change: 1, delete: 0 });
    expect(summary.rootLoopId).toBe('_architect');

    // Architect + 2 leaves persisted.
    expect(planner.inputs).toHaveLength(1);
    expect(files.loops.size).toBe(3);

    const architect = files.loops.get(`cascades/${CASCADE_ID}/_architect.md`)!;
    expect(architect.frontmatter.kind).toBe('architect');
    expect(architect.frontmatter.children).toEqual([
      'rotate-refresh-tokens',
      'invalidate-on-reuse',
    ]);
    expect(architect.frontmatter.status).toBe('awaiting_approval');
    expect(architect.frontmatter.model).toBe('opus');

    const leaf = files.loops.get(`cascades/${CASCADE_ID}/rotate-refresh-tokens.md`)!;
    expect(leaf.frontmatter.kind).toBe('leaf');
    expect(leaf.frontmatter.status).toBe('planned');
    expect(leaf.frontmatter.parent).toBe('_architect');
    expect(leaf.frontmatter.acceptanceCriteria[0].passed).toBe(false);
    expect(leaf.frontmatter.executor).toBe('pi');
  });

  it('throws on an unknown template', async () => {
    const { engine } = makeEngine();
    await expect(engine.kickoff('nope')).rejects.toThrow(/Unknown template/);
  });

  it('enforces the depth cap', async () => {
    const files = new FakeFiles();
    const engine = createCascadeEngine({
      files,
      git: new FakeGit(),
      executor: new FakeExecutor({}),
      planner: new FakePlanner(),
      env: { SLOOP_MAX_DEPTH: '1' } as NodeJS.ProcessEnv,
      now: () => '2026-06-13T09:00:00.000Z',
    });
    await expect(engine.kickoff('spec-driven')).rejects.toThrow(/depth/i);
  });
});

describe('CascadeEngine.get', () => {
  it('returns the derived summary and recomputed loops', async () => {
    const { engine } = makeEngine();
    await engine.kickoff('spec-driven');
    const { summary, loops } = await engine.get(CASCADE_ID);

    expect(summary.status).toBe('awaiting_approval');
    expect(summary.createdAt).toBe('2026-06-13T09:00:00.000Z');
    expect(loops).toHaveLength(3);
    expect(statusOf(loops, '_architect')).toBe('awaiting_approval');
  });

  it('throws for an unknown cascade', async () => {
    const { engine } = makeEngine();
    await expect(engine.get('missing')).rejects.toThrow(/not found/i);
  });
});

describe('CascadeEngine.approve — the convergence money shot', () => {
  it('drives the root to done when every leaf passes', async () => {
    const { engine, executor, outputs } = makeEngine({
      'rotate-refresh-tokens': true,
      'invalidate-on-reuse': true,
    });
    await engine.kickoff('spec-driven');
    await engine.approve(CASCADE_ID);

    const { summary, loops } = await engine.get(CASCADE_ID);
    expect(summary.status).toBe('done');
    expect(statusOf(loops, '_architect')).toBe('done');
    expect(statusOf(loops, 'rotate-refresh-tokens')).toBe('done');
    expect(statusOf(loops, 'invalidate-on-reuse')).toBe('done');

    // Both leaves executed; criteria flipped to passed; output streamed.
    expect(executor.ran).toEqual(['rotate-refresh-tokens', 'invalidate-on-reuse']);
    const leaf = loops.find((l) => l.frontmatter.id === 'rotate-refresh-tokens')!;
    expect(leaf.frontmatter.acceptanceCriteria.every((c) => c.passed)).toBe(true);
    expect(outputs.length).toBeGreaterThan(0);
  });

  it('blocks the root when a leaf fails, isolating the failure', async () => {
    const { engine } = makeEngine({
      'rotate-refresh-tokens': true,
      'invalidate-on-reuse': false,
    });
    await engine.kickoff('spec-driven');
    await engine.approve(CASCADE_ID);

    const { summary, loops } = await engine.get(CASCADE_ID);
    expect(summary.status).toBe('blocked');
    expect(statusOf(loops, '_architect')).toBe('blocked');
    expect(statusOf(loops, 'rotate-refresh-tokens')).toBe('done');
    expect(statusOf(loops, 'invalidate-on-reuse')).toBe('failed');

    const failed = loops.find((l) => l.frontmatter.id === 'invalidate-on-reuse')!;
    expect(failed.frontmatter.acceptanceCriteria.every((c) => c.passed)).toBe(false);
  });
});

describe('CascadeEngine.recomputeStatus', () => {
  it('returns the bubbled-up root status', async () => {
    const { engine } = makeEngine({
      'rotate-refresh-tokens': true,
      'invalidate-on-reuse': true,
    });
    await engine.kickoff('spec-driven');
    expect(await engine.recomputeStatus(CASCADE_ID)).toBe('awaiting_approval');
    await engine.approve(CASCADE_ID);
    expect(await engine.recomputeStatus(CASCADE_ID)).toBe('done');
  });
});
