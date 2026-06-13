// Backend for the sloop HTTP/WS API.
//
// `RealApi` satisfies the `SloopApi` contract, with every method backed by the
// genuine services: FilesService (disk), GitService (the loops diff), the
// AdrRunner (runs an ADR + its subtree through the Pi Executor + verify), and the
// AuthorService.
//
// Live streaming: the runner emits `AdrRunEvent`s *as work happens* via
// `StreamingSloopApi.subscribe(runId, …)`, which the WS layer drives. Events are
// buffered per run so a subscriber that connects mid-run still sees the whole
// progression (status transitions, agent output, eval verdicts, done).

import { registerBuiltInApiProviders, stream } from '@earendil-works/pi-ai';
import { promises as fs } from 'node:fs';
import { join, normalize, dirname, sep } from 'node:path';
import type {
  AdrDoc,
  AdrRunEvent,
  FilesService,
  LoopDoc,
  ModelRegistry,
  ResolvedModel,
  RunHistoryEntry,
} from '../../shared/index';
import { resolveModel } from '../../shared/index';
import { createFilesService } from '../files/index';
import { createGitService } from '../git/index';
import { createExecutor } from '../executor/index';
import { createAdrRunner, Conflict as RunnerConflict, type AdrRunner } from '../adr/adrRunner';
import { planWorkflowScaffold } from '../adr/scaffold';
import { toModelOptions } from '../assistant/index';
import { runAssistantAgent } from '../assistant/agent';
import { createToolExecutor, type AssistantWorkspace } from '../assistant/tools';
import type {
  AdrDiffResponse,
  ApplyWorkflowResponse,
  DeleteAdrResponse,
  GetAdrRunResponse,
  GetModelsResponse,
  MoveAdrResponse,
  Ok,
  PutAdrRequest,
  RunStartedResponse,
  SloopApi,
} from './contract';
import { MoveError, DeleteError } from '../files/filesService';
import type { AssistantChatRequest, AssistantStreamEvent } from '../../shared/index';
import { getLogger, type Logger } from '../log';

const OK: Ok = { ok: true };

/** Thrown for missing resources; `index.ts`'s error funnel maps it to a 404. */
export class NotFound extends Error {}

/** Thrown when a write conflicts (move collision, active run); the error funnel maps it to 409. */
export class Conflict extends Error {}

/**
 * `SloopApi` plus live push. The WS layer (`buildServer.ts`) drives the socket
 * from real runner events via `subscribe`.
 */
export interface StreamingSloopApi extends SloopApi {
  /**
   * Subscribe to a run's event stream. Immediately replays every event buffered so
   * far (so a late subscriber catches up), then streams live ones. `close` is invoked
   * when the run finishes so the socket can be torn down. Returns an unsubscribe function.
   */
  subscribe(
    runId: string,
    send: (event: AdrRunEvent) => void,
    close: () => void,
  ): () => void;
}

/** Truthy-env check shared with the executor's dry-run semantics (0/false/no/off = off). */
export function isDryRun(env: NodeJS.ProcessEnv): boolean {
  const raw = env.SLOOP_DRY_RUN;
  if (!raw) return false;
  const v = raw.toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no' && v !== 'off';
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
  const log = getLogger();
  log.info('Pi providers registered', {
    providers: Object.keys(registry.providers).join(',') || '(none)',
  });
  for (const [name, cfg] of Object.entries(registry.providers)) {
    const hasKey = Boolean(env[cfg.apiKeyEnv]);
    log.info(`provider ${name}`, {
      endpoint: cfg.baseUrl ? cfg.baseUrl : 'built-in',
      key: `${cfg.apiKeyEnv}=${hasKey ? 'set' : 'missing'}`,
    });
  }
}

/**
 * Resolve the model the run's synthetic loop executes on, at run time (never at
 * construction). Honors the loop's `model` alias first, then SLOOP_EXECUTOR_MODEL /
 * SLOOP_PLANNER_MODEL, then a default — so Anthropic/Nebius keys are interchangeable.
 * A missing key throws here (surfaced as a run error), not at boot, so the server
 * starts with zero or partial keys configured.
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
  private constructor(
    private readonly files: FilesService,
    private readonly git: ReturnType<typeof createGitService>,
    private readonly runner: AdrRunner,
    private readonly root: string,
    private readonly env: NodeJS.ProcessEnv,
    private readonly log: Logger,
  ) {}

  static async create(root: string, env: NodeJS.ProcessEnv): Promise<RealApi> {
    const files = createFilesService(root);
    const git = createGitService(root);
    const registry = await files.readModelRegistry();
    bootstrapPi(registry, env);

    const executor = createExecutor((loop) => resolveLeafModel(loop, registry, env), {
      targetRepo: root,
    });
    const log = getLogger();

    const runner = createAdrRunner({
      files,
      executor,
      resolveModel: (alias) => resolveModel(alias, registry, env),
      env,
      onEvent: (runId, event) => logRunEvent(log, runId, event),
    });

    return new RealApi(files, git, runner, root, env, log);
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

  async moveAdr(from: string, to: string): Promise<MoveAdrResponse> {
    try {
      await this.files.moveAdr(from, to);
    } catch (err) {
      if (err instanceof MoveError) {
        if (err.code === 'not_found') throw new NotFound(err.message);
        throw new Conflict(err.message); // 'conflict' | 'invalid'
      }
      throw err;
    }
    return OK;
  }

  async deleteAdr(relPath: string): Promise<DeleteAdrResponse> {
    try {
      await this.files.deleteAdr(relPath);
    } catch (err) {
      if (err instanceof DeleteError) {
        if (err.code === 'not_found') throw new NotFound(err.message);
        throw new Conflict(err.message); // 'invalid' (e.g. path outside loops/)
      }
      throw err;
    }
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

  async listWorkflows() {
    return this.files.listWorkflows();
  }

  async listRoles() {
    return this.files.listRoles();
  }

  /**
   * Stamp a workflow's starter child-ADR tree onto `relPath` (one child per step). Pure
   * planning (`planWorkflowScaffold`) decides the children + the parent's updated `children`
   * list; this method does the IO: write each new child, then the updated parent. Idempotent
   * — children whose id already exists in the workspace are skipped, so re-applying the same
   * workflow never duplicates. Returns the updated parent ADR.
   */
  async applyWorkflow(relPath: string, workflowId: string): Promise<ApplyWorkflowResponse> {
    const parent = await this.getAdr(relPath); // 404 if missing
    const workflows = await this.files.listWorkflows();
    const workflow = workflows.find((w) => w.id === workflowId);
    if (!workflow) throw new NotFound(`Workflow not found: ${workflowId}`);

    // Existing ids across the whole workspace make the scaffold idempotent (a re-apply, or a
    // step whose id collides with an unrelated ADR, is skipped rather than overwriting).
    const existingIds = new Set((await this.files.listAdrs()).map((a) => a.id));
    const { children, parentChildren } = planWorkflowScaffold(parent, workflow, existingIds);

    // Write the new children first so the parent never references a child that isn't on disk.
    for (const child of children) await this.files.writeAdr(child);
    const updated: AdrDoc = { ...parent, children: parentChildren };
    await this.files.writeAdr(updated);
    this.log.info('workflow applied', { adr: relPath, workflow: workflowId, added: children.length });
    return updated;
  }

  // ---- Global assistant ----------------------------------------------------

  async listModels(): Promise<GetModelsResponse> {
    return toModelOptions(await this.files.readModelRegistry(), this.env);
  }

  private assistantWorkspace(): AssistantWorkspace {
    const files = this.files;
    const root = this.root;
    return {
      listAdrs: () => files.listAdrs(),
      readAdr: (p) => files.readAdr(p),
      writeAdr: (d) => files.writeAdr(d),
      listRoles: () => files.listRoles(),
      listWorkflows: () => files.listWorkflows(),
      readModelRegistry: () => files.readModelRegistry(),
      writeRaw: async (relPath, content) => {
        const abs = normalize(join(root, relPath));
        if (abs !== root && !abs.startsWith(root + sep)) throw new Error(`Path escapes the workspace: ${relPath}`);
        const rel = abs.slice(root.length + 1).split(sep).join('/'); // normalize to forward slashes
        const allowed = /^loops\/.+\.md$/.test(rel)
          || /^\.sloop\/(roles|workflows)\/.+\.md$/.test(rel);
        if (!allowed) throw new Error(`Path not writable by the assistant: ${relPath} (only loops/ and .sloop/{roles,workflows}/ *.md)`);
        await fs.mkdir(dirname(abs), { recursive: true });
        await fs.writeFile(abs, content, 'utf8');
      },
    };
  }

  async assistantStream(req: AssistantChatRequest, onEvent: (e: AssistantStreamEvent) => void, signal?: AbortSignal): Promise<void> {
    await runAssistantAgent(req, {
      stream,
      toolExecutor: createToolExecutor(this.assistantWorkspace()),
      env: this.env,
      readModelRegistry: () => this.files.readModelRegistry(),
    }, onEvent, signal);
  }

  // ---- Runs ----------------------------------------------------------------

  async runAdr(relPath: string): Promise<RunStartedResponse> {
    // Confirm the ADR exists before delegating, so a bad path is a clean 404.
    await this.getAdr(relPath);
    this.log.info('adr run requested', { adr: relPath });
    try {
      const { runId } = await this.runner.runAdr(relPath);
      this.log.info('adr run started', { adr: relPath, run: runId });
      return { runId };
    } catch (err) {
      // The runner serializes runs: a second concurrent request is a 409.
      if (err instanceof RunnerConflict) throw new Conflict(err.message);
      throw err;
    }
  }

  getAdrRun(relPath: string): Promise<GetAdrRunResponse> {
    // Pure in-memory lookup; wrapped in a promise to satisfy the async API contract.
    return Promise.resolve(this.runner.getAdrRun(relPath));
  }

  async listRuns(): Promise<RunHistoryEntry[]> {
    return this.runner.listRuns();
  }

  async getRun(runId: string): Promise<RunHistoryEntry> {
    try {
      return await this.runner.getRun(runId);
    } catch (err) {
      throw new NotFound(err instanceof Error ? err.message : `Run not found: ${runId}`);
    }
  }

  subscribe(
    runId: string,
    send: (event: AdrRunEvent) => void,
    close: () => void,
  ): () => void {
    this.log.debug('run stream subscribe', { run: runId });
    return this.runner.subscribe(runId, send, close);
  }
}

/**
 * Mirror a run event to the console: output chunks stream raw (agent text +
 * `[tool]`/`[verify]` markers) so the operator watches work happen live; status/eval/
 * done/error become structured log lines. Verbosity is governed by SLOOP_LOG_LEVEL.
 */
function logRunEvent(log: Logger, runId: string, event: AdrRunEvent): void {
  switch (event.type) {
    case 'output':
      log.stream(event.chunk);
      return;
    case 'status':
      log.info(`run ${runId}: ${event.relPath} → ${event.status}`);
      return;
    case 'eval':
      log.debug(`run ${runId}: ${event.relPath} ${event.criterionId} ${event.passed ? 'PASS' : 'FAIL'}`);
      return;
    case 'done':
      log.info(`run ${runId} complete`, { status: event.status });
      return;
    case 'error':
      log.error(`run ${runId} failed`, { error: event.message });
      return;
  }
}

/** Async factory used by `index.ts` and the CLI to construct the backend. */
export async function createRealApi(root: string, env: NodeJS.ProcessEnv): Promise<RealApi> {
  return RealApi.create(root, env);
}
