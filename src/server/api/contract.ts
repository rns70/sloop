// HTTP/WS API contract between the web app and the Node backend.
//
// `RealApi` (src/server/api/real.ts) implements this surface, backed by the
// FilesService / GitService / CascadeEngine / Executor. The web app talks ONLY to
// this surface (via src/web/api-client) and never imports backend service code.
//
//   GET  /api/adrs                 -> AdrDoc[]
//   GET  /api/adrs/:relPath        -> AdrDoc
//   PUT  /api/adrs/:relPath        -> { ok: true }                 body: PutAdrRequest
//   POST /api/adrs/:relPath/move   -> { ok: true }                 body: MoveAdrRequest
//   DELETE /api/adrs/:relPath      -> { ok: true }
//   GET  /api/adrs/:relPath/diff   -> AdrDiffResponse
//   GET  /api/workflows            -> WorkflowDef[]
//   GET  /api/roles                -> RoleDef[]
//   GET  /api/models               -> ModelOption[]
//   POST /api/assistant/stream  -> SSE AssistantStreamEvent   body: AssistantStreamRequestBody
//   POST /api/adrs/:relPath/apply-workflow -> AdrDoc                stamps a workflow's starter child tree
//   POST /api/adrs/:relPath/run    -> RunStartedResponse           starts a run (409 if active)
//   GET  /api/adrs/:relPath/run    -> GetAdrRunResponse            run to rehydrate this ADR (or null)
//   GET  /api/runs                 -> RunHistoryEntry[]            history drawer feed
//   GET  /api/runs/:runId          -> RunHistoryEntry
//   WS   /api/runs/:runId/stream   -> AdrRunEvent                  live output + status
//
// `:relPath` is URL-encoded (it contains slashes, e.g. loops/adr-007.md).

import type {
  AdrDoc, WorkflowDef, RoleDef,
  AssistantChatRequest, AssistantStreamEvent, ModelOption,
  RunHistoryEntry,
} from '../../shared/index';

export interface Ok {
  ok: true;
}

export type GetAdrsResponse = AdrDoc[];
export type GetAdrResponse = AdrDoc;

/** PUT /api/adrs/:relPath — the full ADR document to persist. */
export type PutAdrRequest = AdrDoc;
export type PutAdrResponse = Ok;

/** POST /api/adrs/:relPath/move — `:relPath` is the source; `to` is the destination
 *  path (both loops-prefixed). Serves file move, file rename, and folder move. */
export interface MoveAdrRequest {
  to: string;
}
export type MoveAdrResponse = Ok;

/** DELETE /api/adrs/:relPath — removes a single ADR file or a whole folder subtree
 *  (loops-prefixed path). Empty parent dirs are pruned. */
export type DeleteAdrResponse = Ok;

export interface AdrDiffResponse {
  before: string;
  after: string;
}

export type GetWorkflowsResponse = WorkflowDef[];
export type GetRolesResponse = RoleDef[];

/** POST /api/adrs/:relPath/apply-workflow — stamp a workflow's starter child-ADR tree onto
 *  this ADR (one child per workflow step). Idempotent: re-applying never duplicates children
 *  whose id already exists. `workflowId` is a WorkflowDef.id. */
export interface ApplyWorkflowRequest {
  workflowId: string;
}
/** The updated parent ADR (with the new child ids appended to `children`). */
export type ApplyWorkflowResponse = AdrDoc;

/** POST /api/adrs/:relPath/run — kicks off a run of this ADR + its subtree.
 *  Returns the run id to subscribe to. 409 if a run is already active (runs are serialized). */
export interface RunStartedResponse {
  runId: string;
}

/** GET /api/adrs/:relPath/run — the run whose buffered events rehydrate this ADR's panel,
 *  or null if the ADR was never part of one. `live: true` means reconnect to a still-active
 *  run; `live: false` means replay a finished run's result. */
export type GetAdrRunResponse = { runId: string; live: boolean } | null;

export type GetRunsResponse = RunHistoryEntry[];
export type GetRunResponse = RunHistoryEntry;

export type GetModelsResponse = ModelOption[];
/** POST /api/assistant/stream — streaming, multi-turn, agentic assistant. */
export type AssistantStreamRequestBody = AssistantChatRequest;

/** Shape the API backend implements. The HTTP/WS layer is a thin adapter over this. */
export interface SloopApi {
  listAdrs(): Promise<GetAdrsResponse>;
  getAdr(relPath: string): Promise<GetAdrResponse>;
  putAdr(relPath: string, doc: PutAdrRequest): Promise<PutAdrResponse>;
  moveAdr(from: string, to: string): Promise<MoveAdrResponse>;
  deleteAdr(relPath: string): Promise<DeleteAdrResponse>;
  getAdrDiff(relPath: string): Promise<AdrDiffResponse>;
  listWorkflows(): Promise<GetWorkflowsResponse>;
  listRoles(): Promise<GetRolesResponse>;
  /** Stamp a workflow's starter child-ADR tree onto `relPath` (one child per step).
   *  Idempotent — re-applying skips children that already exist. Returns the updated parent. */
  applyWorkflow(relPath: string, workflowId: string): Promise<ApplyWorkflowResponse>;
  /** Configured model aliases for the picker (no API keys). */
  listModels(): Promise<GetModelsResponse>;
  /** Streaming agentic assistant: emits events as it thinks/acts; auto-applies writes. */
  assistantStream(req: AssistantChatRequest, onEvent: (e: AssistantStreamEvent) => void, signal?: AbortSignal): Promise<void>;
  /** Run an ADR + its subtree as a single agent pass. Returns the run id. Rejects (409)
   *  if a run is already active — runs are serialized (shared-checkout safety). */
  runAdr(relPath: string): Promise<RunStartedResponse>;
  /** The run that rehydrates `relPath`'s panel (active → live reconnect, else newest finished
   *  run including it → replay), or null if the ADR was never run. */
  getAdrRun(relPath: string): Promise<GetAdrRunResponse>;
  /** Past runs, newest first, for the history drawer. */
  listRuns(): Promise<GetRunsResponse>;
  getRun(runId: string): Promise<GetRunResponse>;
}

/** Re-export so the web client can name the WS event type without reaching into shared. */
export type { AdrRunEvent, RunHistoryEntry } from '../../shared/index';
