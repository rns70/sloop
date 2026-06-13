import type {
  CascadeEngine,
  CascadeSummary,
  Delta,
  Executor,
  FilesService,
  GitService,
  LoopDoc,
  LoopFrontmatter,
  LoopStatus,
} from '../../shared/index';
import { createArchitect, type ArchitectPlanner } from '../planner/architect';
import type { ArchitectPlan } from '../planner/prompt';
import { recompute, rootStatus } from './convergence';

/**
 * The CascadeEngine turns a databank diff into an architect loop that proposes a
 * tree of role-typed leaf loops (following a template), gates on human approval,
 * then drives execution while the convergence invariant (§3) bubbles status up to
 * the root.
 *
 * All side effects go through injected interfaces (`FilesService`, `GitService`,
 * `Executor`, `ArchitectPlanner`), so the whole lifecycle is testable with fakes —
 * no real files, git, model, or executor required.
 */

/** The conventional id/filename of a cascade's root architecture loop. */
const ROOT_LOOP_ID = '_architect';

/** Statuses a proposed loop sits at before approval; flipped to `queued` on approve. */
const PROPOSED: readonly LoopStatus[] = ['planned', 'awaiting_approval'];

export interface CascadeEngineDeps {
  files: FilesService;
  git: GitService;
  executor: Executor;
  /** Defaults to a Pi-backed architect built from `files` + `env`. */
  planner?: ArchitectPlanner;
  env?: NodeJS.ProcessEnv;
  /** Clock injection — returns an ISO timestamp. Defaults to wall-clock. */
  now?: () => string;
  /** Stream a leaf's executor output (e.g. to a WebSocket). Optional. */
  onOutput?: (loopId: string, chunk: string) => void;
}

/** Cascade-level metadata that has no home on a `LoopDoc` (e.g. createdAt). */
interface CascadeMeta {
  createdAt: string;
  template: string;
  deltas: CascadeSummary['deltas'];
}

function emptyDeltas(): CascadeSummary['deltas'] {
  return { add: 0, change: 0, delete: 0 };
}

function tally(deltas: Array<Delta | undefined>): CascadeSummary['deltas'] {
  const out = emptyDeltas();
  for (const d of deltas) {
    if (d) out[d] += 1;
  }
  return out;
}

function loopRelPath(cascadeId: string, loopId: string): string {
  return `cascades/${cascadeId}/${loopId}.md`;
}

function withStatus(loop: LoopDoc, status: LoopStatus): LoopDoc {
  if (loop.frontmatter.status === status) return loop;
  return { ...loop, frontmatter: { ...loop.frontmatter, status } };
}

function findById(loops: LoopDoc[], id: string): LoopDoc | undefined {
  return loops.find((l) => l.frontmatter.id === id);
}

function findRoot(loops: LoopDoc[]): LoopDoc | undefined {
  return loops.find((l) => !l.frontmatter.parent) ?? findById(loops, ROOT_LOOP_ID);
}

/** Record an executor verdict on a leaf: pass/fail every criterion and stage status. */
function applyVerdict(leaf: LoopDoc, ok: boolean): LoopDoc {
  const acceptanceCriteria = leaf.frontmatter.acceptanceCriteria.map((c) => ({ ...c, passed: ok }));
  // `review` is the post-execution holding state; recompute promotes it to `done`
  // once criteria pass. A failed run goes straight to `failed` and blocks ancestors.
  const status: LoopStatus = ok ? 'review' : 'failed';
  return { ...leaf, frontmatter: { ...leaf.frontmatter, acceptanceCriteria, status } };
}

class CascadeEngineImpl implements CascadeEngine {
  private readonly files: FilesService;
  private readonly git: GitService;
  private readonly executor: Executor;
  private readonly planner: ArchitectPlanner;
  private readonly env: NodeJS.ProcessEnv;
  private readonly now: () => string;
  private readonly onOutput?: (loopId: string, chunk: string) => void;
  private readonly maxDepth: number;
  /** In-memory cascade metadata (the disk source of truth is the loop files). */
  private readonly meta = new Map<string, CascadeMeta>();

  constructor(deps: CascadeEngineDeps) {
    this.files = deps.files;
    this.git = deps.git;
    this.executor = deps.executor;
    this.env = deps.env ?? process.env;
    this.planner = deps.planner ?? createArchitect({ files: deps.files, env: this.env });
    this.now = deps.now ?? (() => new Date().toISOString());
    this.onOutput = deps.onOutput;

    const parsed = Number.parseInt(this.env.SLOOP_MAX_DEPTH ?? '', 10);
    this.maxDepth = Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
  }

  async kickoff(templateId: string): Promise<CascadeSummary> {
    const [templates, roles, diff] = await Promise.all([
      this.files.listTemplates(),
      this.files.listRoles(),
      this.git.diffDatabank(),
    ]);

    const template = templates.find((t) => t.id === templateId);
    if (!template) {
      const known = templates.map((t) => t.id).join(', ') || '(none)';
      throw new Error(`Unknown template "${templateId}". Available: ${known}.`);
    }

    const createdAt = this.now();
    const cascadeId = this.makeCascadeId(createdAt, templateId);

    const plan = await this.planner.propose({ cascadeId, diff, template, roles });

    const { architect, leaves } = this.buildLoops(cascadeId, templateId, plan, diff);
    this.enforceDepth(leaves);

    // Persist the root architecture loop (awaiting approval) and its proposed leaves.
    await this.files.writeLoop(architect);
    for (const leaf of leaves) await this.files.writeLoop(leaf);

    const deltas = tally(diff.changed.map((c) => c.delta));
    this.meta.set(cascadeId, { createdAt, template: templateId, deltas });

    return {
      id: cascadeId,
      createdAt,
      template: templateId,
      deltas,
      rootLoopId: ROOT_LOOP_ID,
      status: 'awaiting_approval',
    };
  }

  async get(cascadeId: string): Promise<{ summary: CascadeSummary; loops: LoopDoc[] }> {
    const loops = recompute(await this.loadLoops(cascadeId));
    return { summary: this.deriveSummary(cascadeId, loops), loops };
  }

  async approve(cascadeId: string): Promise<void> {
    let loops = await this.loadLoops(cascadeId);

    // Checkpoint passed: flip every proposed loop to `queued` and persist.
    loops = await this.persistAll(
      loops.map((l) => (PROPOSED.includes(l.frontmatter.status) ? withStatus(l, 'queued') : l)),
    );

    const leafIds = loops
      .filter((l) => l.frontmatter.kind === 'leaf')
      .map((l) => l.frontmatter.id);

    for (const leafId of leafIds) {
      // Mark the leaf executing, run it, record the verdict, then bubble up.
      loops = await this.persistOne(loops, leafId, (l) => withStatus(l, 'executing'));

      const leaf = findById(loops, leafId);
      if (!leaf) continue;
      const { ok } = await this.executor.run(leaf, (chunk) => this.onOutput?.(leafId, chunk));

      loops = await this.persistOne(loops, leafId, (l) => applyVerdict(l, ok));
      loops = await this.recomputeAndPersist(loops);
    }

    await this.recomputeAndPersist(loops);
  }

  async recomputeStatus(cascadeId: string): Promise<LoopStatus> {
    const loops = await this.loadLoops(cascadeId);
    const next = await this.recomputeAndPersist(loops);
    return rootStatus(next);
  }

  // ---- internals -----------------------------------------------------------

  private async loadLoops(cascadeId: string): Promise<LoopDoc[]> {
    const loops = await this.files.listLoops(cascadeId);
    if (loops.length === 0) throw new Error(`Cascade not found: ${cascadeId}`);
    return loops;
  }

  private makeCascadeId(createdAt: string, templateId: string): string {
    const datePart = createdAt.slice(0, 10);
    const base = `${datePart}-${templateId}`;
    if (!this.meta.has(base)) return base;
    let n = 2;
    while (this.meta.has(`${base}-${n}`)) n += 1;
    return `${base}-${n}`;
  }

  private buildLoops(
    cascadeId: string,
    templateId: string,
    plan: ArchitectPlan,
    diff: { changed: Array<{ delta: Delta }> },
  ): { architect: LoopDoc; leaves: LoopDoc[] } {
    const childIds = plan.leaves.map((l) => l.id);

    // The architect's own delta is meaningful only when the diff is homogeneous.
    const deltaKinds = new Set(diff.changed.map((c) => c.delta));
    const architectDelta: Delta | undefined =
      deltaKinds.size === 1 ? [...deltaKinds][0] : undefined;

    const architectFm: LoopFrontmatter = {
      id: ROOT_LOOP_ID,
      kind: 'architect',
      role: 'architect',
      model: plan.plannerAlias,
      status: 'awaiting_approval',
      delta: architectDelta,
      children: childIds,
      template: templateId,
      acceptanceCriteria: [],
    };
    const architect: LoopDoc = {
      frontmatter: architectFm,
      body: plan.summary,
      relPath: loopRelPath(cascadeId, ROOT_LOOP_ID),
    };

    const leaves: LoopDoc[] = plan.leaves.map((leaf) => {
      const fm: LoopFrontmatter = {
        id: leaf.id,
        kind: 'leaf',
        role: leaf.role,
        model: leaf.model,
        status: 'planned',
        delta: leaf.delta,
        parent: ROOT_LOOP_ID,
        children: [],
        sourceAdr: leaf.sourceAdr,
        template: templateId,
        executor: 'pi',
        acceptanceCriteria: leaf.acceptanceCriteria.map((c) => ({
          id: c.id,
          text: c.text,
          verify: c.verify,
          passed: false,
        })),
      };
      return { frontmatter: fm, body: leaf.brief, relPath: loopRelPath(cascadeId, leaf.id) };
    });

    return { architect, leaves };
  }

  /** Guard the configured depth cap (§3) — a hard requirement for safe live demos. */
  private enforceDepth(leaves: LoopDoc[]): void {
    // The proposed tree is flat: architect (depth 1) → leaves (depth 2).
    const depth = leaves.length > 0 ? 2 : 1;
    if (depth > this.maxDepth) {
      throw new Error(
        `Proposed tree depth ${depth} exceeds SLOOP_MAX_DEPTH=${this.maxDepth}. ` +
          `Raise the cap or have the architect propose fewer levels.`,
      );
    }
  }

  private deriveSummary(cascadeId: string, loops: LoopDoc[]): CascadeSummary {
    const meta = this.meta.get(cascadeId);
    const root = findRoot(loops);
    const deltas =
      meta?.deltas ??
      tally(loops.filter((l) => l.frontmatter.kind === 'leaf').map((l) => l.frontmatter.delta));

    return {
      id: cascadeId,
      createdAt: meta?.createdAt ?? '',
      template: meta?.template ?? root?.frontmatter.template ?? '',
      deltas,
      rootLoopId: root?.frontmatter.id ?? ROOT_LOOP_ID,
      status: rootStatus(loops),
    };
  }

  /** Persist every loop and return the same list (kickoff/initial transitions). */
  private async persistAll(loops: LoopDoc[]): Promise<LoopDoc[]> {
    for (const l of loops) await this.files.writeLoop(l);
    return loops;
  }

  /** Apply a transform to one loop by id, persist it, and return the updated list. */
  private async persistOne(
    loops: LoopDoc[],
    id: string,
    transform: (l: LoopDoc) => LoopDoc,
  ): Promise<LoopDoc[]> {
    let updated: LoopDoc | undefined;
    const next = loops.map((l) => {
      if (l.frontmatter.id !== id) return l;
      updated = transform(l);
      return updated;
    });
    if (updated) await this.files.writeLoop(updated);
    return next;
  }

  /** Recompute statuses bottom-up and persist only the loops whose status changed. */
  private async recomputeAndPersist(loops: LoopDoc[]): Promise<LoopDoc[]> {
    const before = new Map(loops.map((l) => [l.frontmatter.id, l.frontmatter.status]));
    const next = recompute(loops);
    for (const l of next) {
      if (before.get(l.frontmatter.id) !== l.frontmatter.status) {
        await this.files.writeLoop(l);
      }
    }
    return next;
  }
}

/**
 * Factory exported for WP-6 integration: `createCascadeEngine({ files, git, executor })`.
 * The planner defaults to a Pi-backed architect; tests inject a fake planner +
 * fake services.
 */
export function createCascadeEngine(deps: CascadeEngineDeps): CascadeEngine {
  return new CascadeEngineImpl(deps);
}
