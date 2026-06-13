// Real backend for the sloop HTTP/WS API — the WP-6 swap for WP-0's MockApi.
//
// `RealApi` satisfies the exact same `SloopApi` contract the mock does, but every
// method is backed by the genuine services: FilesService (disk), GitService (the
// databank diff), CascadeEngine (architect → leaves → convergence), the Pi Executor
// (leaf execution + verify), and WP-7's AuthorService. The HTTP/WS adapter in
// `index.ts` is unchanged except for the one-line construction + the live WS path.
//
// Live streaming: the mock returns a scripted event array from `streamEvents()`. The
// real engine instead emits events *as work happens* — so `RealApi` also implements
// `StreamingSloopApi.subscribe()`, which `index.ts` prefers for real runs. Events are
// captured two ways and buffered per cascade so a subscriber that connects mid-run
// (the UI subscribes only after `approve`) still sees the whole progression:
//   - loop-update — by decorating `FilesService.writeLoop`: every persisted status
//     change becomes a `{type:'loop-update', loop}` event (the engine persists on
//     every transition, so this captures queued → executing → review → done and the
//     root flipping to done — the convergence "money shot").
//   - output      — via the engine's `onOutput(loopId, chunk)` hook.

import { registerBuiltInApiProviders } from '@earendil-works/pi-ai';
import type {
  AdrDoc,
  CascadeEngine,
  CascadeSummary,
  FilesService,
  LoopDoc,
  ModelRegistry,
  ResolvedModel,
} from '../../shared/index';
import { resolveModel } from '../../shared/index';
import { createFilesService } from '../files/index';
import { createGitService } from '../git/index';
import { createExecutor } from '../executor/index';
import { createCascadeEngine } from '../cascade/cascadeEngine';
import { createArchitect, pickPlannerAlias, type ArchitectPlanner } from '../planner/architect';
import type { ArchitectPlan, ProposedLeaf } from '../planner/prompt';
import { createAssistantService, toModelOptions, type AssistantService } from '../assistant/index';
import type {
  AdrDiffResponse,
  ApproveCascadeResponse,
  AssistantResponse,
  CascadeDetail,
  CascadeStreamEvent,
  CreateCascadeRequest,
  GetModelsResponse,
  Ok,
  PutAdrRequest,
  SloopApi,
} from './contract';
import type { AssistantRequest } from '../../shared/index';

const OK: Ok = { ok: true };

/** Thrown for missing resources; `index.ts`'s error funnel maps it to a 404. */
export class NotFound extends Error {}

/**
 * `SloopApi` plus live push. `index.ts` feature-detects `subscribe` to drive the
 * WebSocket from real engine events instead of replaying a scripted array.
 */
export interface StreamingSloopApi extends SloopApi {
  /**
   * Subscribe to a cascade's event stream. Immediately replays every event buffered
   * so far (so a late subscriber catches up), then streams live ones. `close` is
   * invoked when the cascade run finishes so the socket can be torn down. Returns an
   * unsubscribe function.
   */
  subscribe(
    cascadeId: string,
    send: (event: CascadeStreamEvent) => void,
    close: () => void,
  ): () => void;
}

/** Per-cascade live stream state: a replay buffer + active sinks + completion flag. */
interface Stream {
  buffer: CascadeStreamEvent[];
  sinks: Set<{ send: (e: CascadeStreamEvent) => void; close: () => void }>;
  done: boolean;
}

/** Truthy-env check shared with the executor's dry-run semantics (0/false/no/off = off). */
export function isDryRun(env: NodeJS.ProcessEnv): boolean {
  const raw = env.SLOOP_DRY_RUN;
  if (!raw) return false;
  const v = raw.toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no' && v !== 'off';
}

/** Extract the cascade id from a loop relPath (`cascades/<id>/<loop>.md`). */
function cascadeIdOf(relPath: string): string | undefined {
  const m = /^cascades\/([^/]+)\//.exec(relPath);
  return m?.[1];
}

/**
 * Bootstrap Pi's provider layer at startup.
 *
 * pi-ai dispatches every `complete()` / agent call on `model.api`, so the built-in
 * API implementations (`anthropic-messages`, `openai-completions`, …) must be
 * registered before the first model call or it throws "No API provider registered".
 * This is the real-world form of the handoff's "registerProvider" step: Nebius
 * (NVIDIA Nemotron) is the `openai-completions` API, and its per-call `baseUrl` + key
 * come from the registry via `resolveModel` when each service builds its `Model`.
 * We register the built-ins once, then log provider readiness so a missing key
 * surfaces loudly at boot rather than deep inside a request.
 */
export function bootstrapPi(registry: ModelRegistry, env: NodeJS.ProcessEnv): void {
  registerBuiltInApiProviders();
  const lines = Object.entries(registry.providers).map(([name, cfg]) => {
    const hasKey = Boolean(env[cfg.apiKeyEnv]);
    const where = cfg.baseUrl ? cfg.baseUrl : 'built-in';
    return `  ${name}: ${where} · ${cfg.apiKeyEnv}=${hasKey ? 'set ✓' : 'missing'}`;
  });
  // eslint-disable-next-line no-console
  console.log(`[sloop] Pi providers registered. Registry:\n${lines.join('\n') || '  (none)'}`);
}

/**
 * Deterministic, network-free architect used in dry-run / offline demos.
 *
 * The real architect calls a big model to decompose the diff; for a reliable demo
 * without API keys we instead derive the plan directly from the databank diff: one
 * engineer leaf per changed ADR, copying that ADR's acceptance criteria (id + text +
 * `verify`) onto the leaf — exactly what the spec-driven template prescribes. This
 * exercises the *entire* real engine (files, git, convergence, executor, verify,
 * status bubbling); only the LLM planning call is replaced.
 */
function createOfflinePlanner(files: FilesService, env: NodeJS.ProcessEnv): ArchitectPlanner {
  return {
    async propose({ template, diff }): Promise<ArchitectPlan> {
      const plannerAlias = pickPlannerAlias(env, template);
      const engineerStage =
        template.stages.find((s) => s.role === 'engineer') ??
        template.stages[1] ??
        template.stages[0];
      const leafModel = engineerStage?.model ?? 'haiku';

      const leaves: ProposedLeaf[] = [];
      for (const change of diff.changed) {
        if (change.delta === 'delete') continue; // nothing to implement for a removed ADR
        const adr = await files.readAdr(change.relPath).catch(() => undefined);
        if (!adr) continue;
        const slug = (adr.id || change.relPath.replace(/\W+/g, '-')).toLowerCase();
        leaves.push({
          id: `implement-${slug}`,
          role: engineerStage?.role ?? 'engineer',
          model: leafModel,
          delta: change.delta,
          sourceAdr: adr.id || undefined,
          brief:
            `Reconcile the codebase to **${adr.title || adr.id}** (${change.delta}). ` +
            `Make the change so every acceptance criterion below passes.`,
          acceptanceCriteria: adr.acceptanceCriteria.map((c) => ({
            id: c.id,
            text: c.text,
            verify: c.verify,
          })),
        });
      }

      if (leaves.length === 0) {
        throw new Error(
          'Offline planner: the databank diff has no actionable ADR changes to reconcile. ' +
            'Edit an ADR under databank/ before kicking off (dry-run derives leaves from the diff).',
        );
      }

      return {
        plannerAlias,
        summary:
          `Offline plan (dry-run): ${leaves.length} engineer leaf loop(s) derived from the ` +
          `databank diff, following the ${template.name} template. Each leaf carries its ADR's ` +
          `acceptance criteria; convergence bubbles up as each \`verify\` command passes.`,
        leaves,
      };
    },
  };
}

/**
 * Resolve the model a single leaf runs on, at run time (never at construction). Honors the
 * leaf's own planned `model` alias first, then SLOOP_EXECUTOR_MODEL / SLOOP_PLANNER_MODEL,
 * then a default — so the architect can route different leaves to different providers and
 * Anthropic/Nebius keys are interchangeable per leaf. A missing key throws here (per-leaf
 * "blocked"), not at boot, so the server starts with zero or partial keys configured.
 */
function resolveLeafModel(
  loop: LoopDoc,
  registry: ModelRegistry,
  env: NodeJS.ProcessEnv,
): ResolvedModel {
  const alias =
    loop.frontmatter.model?.trim() ||
    env.SLOOP_EXECUTOR_MODEL?.trim() ||
    env.SLOOP_PLANNER_MODEL?.trim() ||
    'sonnet';
  return resolveModel(alias, registry, env);
}

/**
 * The real `SloopApi`, wired to genuine services. Construct via {@link createRealApi}
 * (async — it reads the registry and bootstraps Pi).
 */
export class RealApi implements StreamingSloopApi {
  private readonly streams = new Map<string, Stream>();
  /** loopId → cascadeId, so the engine's `onOutput(loopId, …)` can route by cascade. */
  private readonly loopCascade = new Map<string, string>();

  private constructor(
    private readonly files: FilesService,
    private readonly git: ReturnType<typeof createGitService>,
    private readonly engine: CascadeEngine,
    private readonly assistantService: AssistantService,
    private readonly env: NodeJS.ProcessEnv,
  ) {}

  static async create(root: string, env: NodeJS.ProcessEnv): Promise<RealApi> {
    const files = createFilesService(root);
    const git = createGitService(root);
    const registry = await files.readModelRegistry();
    bootstrapPi(registry, env);

    const executor = createExecutor((loop) => resolveLeafModel(loop, registry, env));
    const assistantService = createAssistantService({ files, env });

    // Late-bound holder so the writeLoop decorator can reach the not-yet-created instance.
    const ref: { api?: RealApi } = {};
    const emittingFiles = decorateFiles(files, (loop) => ref.api?.onLoopWrite(loop));

    const planner: ArchitectPlanner = isDryRun(env)
      ? createOfflinePlanner(files, env)
      : createArchitect({ files, env });

    const engine = createCascadeEngine({
      files: emittingFiles,
      git,
      executor,
      planner,
      env,
      onOutput: (loopId, chunk) => ref.api?.onLoopOutput(loopId, chunk),
    });

    const api = new RealApi(files, git, engine, assistantService, env);
    ref.api = api;
    return api;
  }

  // ---- ADRs ----------------------------------------------------------------

  async listAdrs(): Promise<AdrDoc[]> {
    return this.files.listAdrs();
  }

  async getAdr(relPath: string): Promise<AdrDoc> {
    return this.files.readAdr(relPath).catch(() => {
      throw new NotFound(`ADR not found: ${relPath}`);
    });
  }

  async putAdr(relPath: string, doc: PutAdrRequest): Promise<Ok> {
    await this.files.writeAdr({ ...doc, relPath });
    return OK;
  }

  async getAdrDiff(relPath: string): Promise<AdrDiffResponse> {
    const diff = await this.git.diffDatabank();
    const entry = diff.changed.find((c) => c.relPath === relPath);
    if (entry) return { before: entry.before, after: entry.after };
    // Unchanged vs HEAD: show the current content on both sides (no diff to render).
    const adr = await this.getAdr(relPath);
    return { before: adr.body, after: adr.body };
  }

  // ---- Libraries -----------------------------------------------------------

  async listTemplates() {
    return this.files.listTemplates();
  }

  async listRoles() {
    return this.files.listRoles();
  }

  // ---- Global assistant ----------------------------------------------------

  async listModels(): Promise<GetModelsResponse> {
    return toModelOptions(await this.files.readModelRegistry(), this.env);
  }

  async assistant(req: AssistantRequest): Promise<AssistantResponse> {
    return this.assistantService.assistant(req);
  }

  // ---- Cascades ------------------------------------------------------------

  async listCascades(): Promise<CascadeSummary[]> {
    // Enumerate cascade dirs, then derive each summary via the engine (same path
    // as `getCascade`). A dir that fails to load (mid-write, malformed) is skipped
    // so the sidebar still lists the rest. Newest first: ids are date-prefixed, so
    // a descending id sort is chronological — matching the mock.
    const ids = await this.files.listCascadeIds();
    const summaries = await Promise.all(
      ids.map((id) =>
        this.engine
          .get(id)
          .then((detail) => detail.summary)
          .catch(() => undefined),
      ),
    );
    return summaries
      .filter((s): s is CascadeSummary => s !== undefined)
      .sort((a, b) => b.id.localeCompare(a.id));
  }

  async createCascade(req: CreateCascadeRequest): Promise<CascadeSummary> {
    const summary = await this.engine.kickoff(req.templateId);
    // Prime a stream buffer so a subscriber can attach the instant approval starts.
    this.streamFor(summary.id);
    return summary;
  }

  async getCascade(id: string): Promise<CascadeDetail> {
    try {
      return await this.engine.get(id);
    } catch (err) {
      throw new NotFound(err instanceof Error ? err.message : `Cascade not found: ${id}`);
    }
  }

  async approveCascade(id: string): Promise<ApproveCascadeResponse> {
    // Confirm the cascade exists before kicking off background execution.
    await this.getCascade(id);
    const stream = this.streamFor(id);
    stream.done = false;

    // Run the cascade in the background and return immediately: the UI awaits this
    // POST, then opens the WS. Buffered events guarantee nothing is missed in the gap.
    void this.engine
      .approve(id)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.emit(id, {
          type: 'output',
          loopId: id,
          chunk: `\n[sloop] cascade failed: ${message}\n`,
        });
      })
      .finally(() => this.finish(id));

    return OK;
  }

  /** Contract method: a snapshot of events so far. Real WS uses `subscribe` instead. */
  async streamEvents(id: string): Promise<CascadeStreamEvent[]> {
    return [...this.streamFor(id).buffer];
  }

  subscribe(
    id: string,
    send: (event: CascadeStreamEvent) => void,
    close: () => void,
  ): () => void {
    const stream = this.streamFor(id);
    // Replay everything buffered so far, then register for live events. No await
    // between replay and registration, so the single-threaded event loop cannot
    // interleave an emit and drop or duplicate a frame.
    for (const event of stream.buffer) send(event);
    if (stream.done) {
      close();
      return () => undefined;
    }
    const sink = { send, close };
    stream.sinks.add(sink);
    return () => {
      stream.sinks.delete(sink);
    };
  }

  // ---- internals -----------------------------------------------------------

  private streamFor(id: string): Stream {
    let stream = this.streams.get(id);
    if (!stream) {
      stream = { buffer: [], sinks: new Set(), done: false };
      this.streams.set(id, stream);
    }
    return stream;
  }

  private emit(id: string, event: CascadeStreamEvent): void {
    const stream = this.streamFor(id);
    stream.buffer.push(event);
    for (const sink of stream.sinks) sink.send(event);
  }

  private finish(id: string): void {
    const stream = this.streams.get(id);
    if (!stream) return;
    stream.done = true;
    for (const sink of stream.sinks) sink.close();
    stream.sinks.clear();
  }

  /** A persisted loop → a loop-update event (routed by its cascade id). */
  private onLoopWrite(loop: LoopDoc): void {
    const id = cascadeIdOf(loop.relPath);
    if (!id) return;
    this.loopCascade.set(loop.frontmatter.id, id);
    this.emit(id, { type: 'loop-update', loop });
  }

  /** A streamed executor chunk → an output event (routed via loopId → cascade). */
  private onLoopOutput(loopId: string, chunk: string): void {
    const id = this.loopCascade.get(loopId);
    if (!id) return;
    this.emit(id, { type: 'output', loopId, chunk });
  }
}

/**
 * Wrap a `FilesService` so every `writeLoop` also fires `onWrite(loop)` — the seam
 * that turns the engine's normal persistence into a live loop-update stream without
 * the engine knowing anything about WebSockets.
 */
function decorateFiles(inner: FilesService, onWrite: (loop: LoopDoc) => void): FilesService {
  return {
    listAdrs: () => inner.listAdrs(),
    readAdr: (p) => inner.readAdr(p),
    writeAdr: (d) => inner.writeAdr(d),
    moveAdr: (f, t) => inner.moveAdr(f, t),
    deleteAdr: (p) => inner.deleteAdr(p),
    readLoop: (p) => inner.readLoop(p),
    listLoops: (c) => inner.listLoops(c),
    listCascadeIds: () => inner.listCascadeIds(),
    listTemplates: () => inner.listTemplates(),
    listRoles: () => inner.listRoles(),
    readModelRegistry: () => inner.readModelRegistry(),
    async writeLoop(loop) {
      await inner.writeLoop(loop);
      onWrite(loop);
    },
  };
}

/** Async factory mirroring `new MockApi(root)` — used by `index.ts` for real runs. */
export async function createRealApi(root: string, env: NodeJS.ProcessEnv): Promise<RealApi> {
  return RealApi.create(root, env);
}
