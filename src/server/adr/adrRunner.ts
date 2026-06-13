// Executable-ADR runner. Replaces the cascade engine: running an ADR pulls its whole
// `children` subtree into ONE synthetic loop, hands it to the Pi executor, then writes
// pass/fail status back onto each ADR. Runs are serialized (one active run; a second
// request throws `Conflict`) per the shared-checkout hazard — a single agent edits one
// working tree at a time.

import type {
  AdrDoc,
  AdrRunEvent,
  AdrStatus,
  AcceptanceCriterion,
  Executor,
  FilesService,
  LoopDoc,
  ResolvedModel,
  RoleDef,
  RunHistoryEntry,
  WorkflowDef,
} from '../../shared/index';

/** Thrown when a second run is requested while one is active; the API maps it to 409. */
export class Conflict extends Error {}

/** Default model alias when neither the source ADR's workflow nor role pins one. */
const DEFAULT_MODEL_ALIAS = 'sonnet';

/** Separator between an ADR's relPath and a criterion id, so namespaced ids round-trip. */
const NS = '::';

export interface AdrRunnerDeps {
  files: Pick<FilesService, 'listAdrs' | 'readAdr' | 'writeAdr' | 'listWorkflows' | 'listRoles'>;
  executor: Executor;
  /** Resolve a model alias to a concrete provider/id/key. Only used to validate the alias
   *  exists; the executor re-resolves per run. Optional — absent means "trust the alias". */
  resolveModel?: (alias: string) => ResolvedModel;
  env: NodeJS.ProcessEnv;
  /** Sink for live run events (drives the WS stream + console). */
  onEvent?: (runId: string, event: AdrRunEvent) => void;
}

/** Identifies the run whose buffer rehydrates a given ADR's panel: an active run (live)
 *  or the newest finished run that included the ADR (replay-only). */
export interface AdrRunRef {
  runId: string;
  /** True if this is the currently-active run (stream live); false for a finished replay. */
  live: boolean;
}

/** The active run, tracked so `getAdrRun` can match an ADR against its run-set membership. */
export interface ActiveRun {
  runId: string;
  rootRelPath: string;
  runSetPaths: string[];
}

export interface AdrRunner {
  runAdr(relPath: string): Promise<{ runId: string }>;
  listRuns(): Promise<RunHistoryEntry[]>;
  getRun(runId: string): Promise<RunHistoryEntry>;
  /**
   * The run that rehydrates `relPath`'s panel, or null if it was never part of one.
   * Prefers the active run (if its run-set covers `relPath`) → live; else the newest
   * history entry whose run-set includes `relPath` → replay-only.
   */
  getAdrRun(relPath: string): { runId: string; live: boolean } | null;
  subscribe(runId: string, send: (e: AdrRunEvent) => void, close: () => void): () => void;
}

/**
 * Pure selection: pick the run that should rehydrate `relPath`. Match on run-set
 * *membership* (not just the root), so a child ADR that was pulled into a parent's run
 * also rehydrates. The active run wins when it covers `relPath` (live reconnect); else
 * the newest finished run that included it (history is newest-first). Null if neither.
 */
export function selectAdrRun(
  relPath: string,
  active: ActiveRun | null,
  history: RunHistoryEntry[],
): AdrRunRef | null {
  if (active && active.runSetPaths.includes(relPath)) {
    return { runId: active.runId, live: true };
  }
  const finished = history.find((h) => h.runSet.includes(relPath));
  return finished ? { runId: finished.id, live: false } : null;
}

/**
 * Compute the ordered run-set for a source ADR: itself plus all recursive descendants,
 * depth-first in `children` order. `children` hold child *relPaths*; this resolves them
 * via a relPath→doc map. Cycles are broken (a node already on the path/visited is
 * skipped) and unknown child relPaths are silently dropped.
 */
export function planRunSet(adrs: AdrDoc[], rootRelPath: string): string[] {
  const byRelPath = new Map(adrs.map((a) => [a.relPath, a]));
  const root = byRelPath.get(rootRelPath);
  if (!root) return [];

  const ordered: string[] = [];
  const visited = new Set<string>();

  const walk = (adr: AdrDoc): void => {
    if (visited.has(adr.relPath)) return; // cycle / diamond — include once
    visited.add(adr.relPath);
    ordered.push(adr.relPath);
    for (const childPath of adr.children) {
      const child = byRelPath.get(childPath);
      if (child) walk(child); // unknown relPaths are skipped
    }
  };

  walk(root);
  return ordered;
}

/** Per-run live stream state: a replay buffer + active sinks + completion flag. */
interface RunStream {
  buffer: AdrRunEvent[];
  sinks: Set<{ send: (e: AdrRunEvent) => void; close: () => void }>;
  done: boolean;
}

/**
 * Resolve the model alias a run executes on: the source ADR's role default, else its
 * workflow's first step model, else env overrides, else a registry default. The executor
 * re-resolves the concrete provider/key at run time, so this only needs to pick an alias.
 */
function resolveRunModel(
  source: AdrDoc,
  workflows: WorkflowDef[],
  roles: RoleDef[],
  env: NodeJS.ProcessEnv,
): string {
  const role = source.role ? roles.find((r) => r.id === source.role) : undefined;
  if (role?.defaultModel?.trim()) return role.defaultModel.trim();

  const workflow = source.workflow ? workflows.find((w) => w.id === source.workflow) : undefined;
  const stepModel = workflow?.steps.find((s) => s.model?.trim())?.model?.trim();
  if (stepModel) return stepModel;

  return env.SLOOP_EXECUTOR_MODEL?.trim() || env.SLOOP_PLANNER_MODEL?.trim() || DEFAULT_MODEL_ALIAS;
}

/** Namespace a criterion id with its owning ADR's relPath so ids stay unique across the run-set. */
function namespaceId(relPath: string, criterionId: string): string {
  return `${relPath}${NS}${criterionId}`;
}

/** Split a namespaced criterion id back into `{ relPath, criterionId }`. */
function denamespaceId(id: string): { relPath: string; criterionId: string } {
  const idx = id.indexOf(NS);
  if (idx === -1) return { relPath: '', criterionId: id };
  return { relPath: id.slice(0, idx), criterionId: id.slice(idx + NS.length) };
}

/**
 * A resolved persona for the run: the role's display name + brief. Passed into
 * `buildSyntheticLoop` so the agent is told *who* it is acting as before the work.
 */
export interface RunPersona {
  name: string;
  brief: string;
}

/**
 * A resolved workflow for the run: the workflow's display name + guidance prose. Injected
 * into the synthetic body the SAME way a role's brief is, so the run is steered by the
 * workflow's house rules in addition to the role persona.
 */
export interface RunGuidance {
  name: string;
  guidance: string;
}

/**
 * Build the preamble prepended to the synthetic body. Role persona comes first ("who you
 * are"), then workflow guidance ("how this workflow wants the work done"), then a `---`
 * separator before the concatenated ADR bodies. Each block is omitted when its source is
 * missing/empty, and the whole preamble (incl. the separator) is `''` when neither is
 * present — so behavior is unchanged for ADRs with no role and no workflow. Exported for
 * unit tests.
 */
export function buildRunPreamble(persona: RunPersona | undefined, guidance: RunGuidance | undefined): string {
  const blocks: string[] = [];
  if (persona && persona.brief.trim()) {
    blocks.push(`You are acting as the "${persona.name}" role.\n${persona.brief.trim()}`);
  }
  if (guidance && guidance.guidance.trim()) {
    blocks.push(`Workflow "${guidance.name}" guidance:\n${guidance.guidance.trim()}`);
  }
  if (blocks.length === 0) return '';
  return `${blocks.join('\n\n')}\n\n---\n\n`;
}

/**
 * Build the single synthetic `LoopDoc` the executor runs for a whole run-set:
 *  - body optionally opens with a role-persona + workflow-guidance preamble (see
 *    `buildRunPreamble`), then concatenates each ADR's body under a `## <relPath>` header;
 *  - acceptanceCriteria is the UNION of every run-set ADR's criteria, each id namespaced
 *    `<relPath>::<id>` so a verify verdict maps back to its owning ADR;
 *  - allowedOutputs is the UNION of every ADR's `outputs` (the edit sandbox). If ANY ADR
 *    has no outputs the sandbox stays unrestricted (empty = unrestricted in the executor),
 *    so we only constrain when every ADR opted in.
 */
export function buildSyntheticLoop(
  rootRelPath: string,
  runSet: AdrDoc[],
  model: string,
  persona?: RunPersona,
  guidance?: RunGuidance,
): LoopDoc {
  const bodyParts = runSet.map((adr) => `## ${adr.relPath}\n\n${adr.body.trim()}`);

  const acceptanceCriteria: AcceptanceCriterion[] = [];
  for (const adr of runSet) {
    for (const c of adr.acceptanceCriteria) {
      acceptanceCriteria.push({
        id: namespaceId(adr.relPath, c.id),
        text: c.text,
        ...(c.verify !== undefined ? { verify: c.verify } : {}),
        passed: false,
      });
    }
  }

  // Union of outputs. Constrain only when every ADR declares an allow-list — otherwise an
  // unconstrained ADR would be silently sandboxed by its siblings' globs.
  const everyAdrConstrained = runSet.every((a) => a.outputs.length > 0);
  const allowedOutputs = everyAdrConstrained
    ? [...new Set(runSet.flatMap((a) => a.outputs))]
    : undefined;

  return {
    frontmatter: {
      id: `run-${rootRelPath}`,
      kind: 'leaf',
      role: runSet[0]?.role ?? 'engineer',
      model,
      status: 'executing',
      children: [],
      workflow: runSet[0]?.workflow,
      acceptanceCriteria,
      ...(allowedOutputs ? { allowedOutputs } : {}),
      executor: 'pi',
    },
    body: buildRunPreamble(persona, guidance) + bodyParts.join('\n\n'),
    relPath: rootRelPath,
  };
}

/** Construct the ADR runner. Side effects go through the injected `files`/`executor`. */
export function createAdrRunner(deps: AdrRunnerDeps): AdrRunner {
  const { files, executor, env, onEvent } = deps;
  const streams = new Map<string, RunStream>();
  const history: RunHistoryEntry[] = []; // newest first
  // The active run, or null when idle. Kept as the full {id, root, run-set} so
  // `getAdrRun` can match an ADR against run-set membership for live reconnect.
  let active: ActiveRun | null = null;
  let runSeq = 0;

  const streamFor = (runId: string): RunStream => {
    let s = streams.get(runId);
    if (!s) {
      s = { buffer: [], sinks: new Set(), done: false };
      streams.set(runId, s);
    }
    return s;
  };

  const emit = (runId: string, event: AdrRunEvent): void => {
    const s = streamFor(runId);
    s.buffer.push(event);
    for (const sink of s.sinks) sink.send(event);
    onEvent?.(runId, event);
  };

  const finish = (runId: string): void => {
    const s = streams.get(runId);
    if (!s) return;
    s.done = true;
    for (const sink of s.sinks) sink.close();
    s.sinks.clear();
  };

  /** Persist a status onto one ADR (by relPath) and emit a `status` event. */
  const setStatus = async (runId: string, relPath: string, status: AdrStatus): Promise<void> => {
    const adr = await files.readAdr(relPath);
    await files.writeAdr({ ...adr, status });
    emit(runId, { type: 'status', relPath, status });
  };

  const execute = async (
    runId: string,
    rootRelPath: string,
    runSetPaths: string[],
    syntheticLoop: LoopDoc,
  ): Promise<void> => {
    // running → (executor) → evaluating (executor verifies internally) → passed/failed.
    for (const relPath of runSetPaths) await setStatus(runId, relPath, 'running');

    const { ok } = await executor.run(syntheticLoop, (chunk) =>
      emit(runId, { type: 'output', relPath: rootRelPath, chunk }),
    );

    // The executor mutated each criterion's `.passed`. Surface per-criterion eval verdicts,
    // de-namespacing the id back to its owning ADR (best-effort relPath attribution).
    const evidence: string[] = [];
    for (const c of syntheticLoop.frontmatter.acceptanceCriteria) {
      const { relPath, criterionId } = denamespaceId(c.id);
      emit(runId, { type: 'eval', relPath: relPath || rootRelPath, criterionId, passed: c.passed });
      if (!c.passed) evidence.push(`${relPath || rootRelPath}: ${criterionId} — ${c.text}`);
    }

    const finalStatus: AdrStatus = ok ? 'passed' : 'failed';
    for (const relPath of runSetPaths) await setStatus(runId, relPath, finalStatus);

    const entry: RunHistoryEntry = {
      id: runId,
      rootRelPath,
      runSet: runSetPaths,
      status: ok ? 'passed' : 'failed',
      createdAt: new Date().toISOString(),
      evidence,
    };
    history.unshift(entry);
    emit(runId, { type: 'done', runId, status: entry.status });
  };

  return {
    async runAdr(relPath) {
      if (active) {
        throw new Conflict(
          `A run is already active (${active.runId}); runs are serialized — wait for it to finish.`,
        );
      }

      const [adrs, workflows, roles] = await Promise.all([
        files.listAdrs(),
        files.listWorkflows(),
        files.listRoles(),
      ]);
      const source = adrs.find((a) => a.relPath === relPath);
      if (!source) throw new Error(`ADR not found: ${relPath}`);

      const runSetPaths = planRunSet(adrs, relPath);
      const byRelPath = new Map(adrs.map((a) => [a.relPath, a]));
      const runSet = runSetPaths.map((p) => byRelPath.get(p)!).filter(Boolean);

      const model = resolveRunModel(source, workflows, roles, env);
      // Resolve the SOURCE ADR's role into a persona (name + brief) so the synthetic
      // body opens by telling the agent who it is acting as. A role-less ADR (or one
      // whose role has no brief) yields no preamble — unchanged behavior.
      const sourceRole = source.role ? roles.find((r) => r.id === source.role) : undefined;
      const persona: RunPersona | undefined = sourceRole
        ? { name: sourceRole.name, brief: sourceRole.brief }
        : undefined;
      // Resolve the SOURCE ADR's workflow into guidance (name + prose), injected into the
      // synthetic body the same way the persona is. A workflow-less ADR (or one whose
      // workflow has no guidance) contributes no block — unchanged behavior.
      const sourceWorkflow = source.workflow ? workflows.find((w) => w.id === source.workflow) : undefined;
      const guidance: RunGuidance | undefined = sourceWorkflow
        ? { name: sourceWorkflow.name, guidance: sourceWorkflow.guidance }
        : undefined;
      // Fail fast on a bad alias / missing provider key — but only when we'll actually
      // call the model. In dry-run the executor skips the agent, so resolution (and its
      // API-key requirement) must be skipped too, mirroring piExecutor's dry-run path.
      const rawDry = env.SLOOP_DRY_RUN?.toLowerCase();
      const dry = !!rawDry && rawDry !== '0' && rawDry !== 'false' && rawDry !== 'no' && rawDry !== 'off';
      if (!dry) deps.resolveModel?.(model);

      const syntheticLoop = buildSyntheticLoop(relPath, runSet, model, persona, guidance);

      runSeq += 1;
      const runId = `run-${Date.now()}-${runSeq}`;
      active = { runId, rootRelPath: relPath, runSetPaths };
      streamFor(runId); // prime the buffer so a subscriber can attach immediately

      // Run in the background; the API returns the runId and the UI opens the WS.
      void execute(runId, relPath, runSetPaths, syntheticLoop)
        .catch((err: unknown) => {
          emit(runId, { type: 'error', message: err instanceof Error ? err.message : String(err) });
        })
        .finally(() => {
          finish(runId);
          if (active?.runId === runId) active = null;
        });

      return { runId };
    },

    async listRuns() {
      return [...history];
    },

    async getRun(runId) {
      const entry = history.find((r) => r.id === runId);
      if (!entry) throw new Error(`Run not found: ${runId}`);
      return entry;
    },

    getAdrRun(relPath) {
      return selectAdrRun(relPath, active, history);
    },

    subscribe(runId, send, close) {
      const s = streamFor(runId);
      for (const event of s.buffer) send(event);
      if (s.done) {
        close();
        return () => undefined;
      }
      const sink = { send, close };
      s.sinks.add(sink);
      return () => {
        s.sinks.delete(sink);
      };
    },
  };
}
