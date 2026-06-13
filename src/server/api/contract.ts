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
//   GET  /api/cascades             -> CascadeSummary[]
//   POST /api/cascades             -> CascadeSummary               body: CreateCascadeRequest
//   GET  /api/cascades/:id         -> CascadeDetail
//   POST /api/cascades/:id/approve -> { ok: true }
//   PATCH /api/cascades/:id/loops/:loopId -> LoopDoc          body: UpdateLoopRequest
//   WS   /api/cascades/:id/stream  -> CascadeStreamEvent
//
// `:relPath` is URL-encoded (it contains slashes, e.g. databank/adr-007.md).

import type {
  AdrDoc, WorkflowDef, RoleDef, CascadeSummary, LoopDoc,
  AssistantChatRequest, AssistantStreamEvent, ModelOption,
} from '../../shared/index';

/** PATCH /api/cascades/:id/loops/:loopId — fields to change on a not-yet-executing loop.
 *  Every field is optional; omitted fields are left untouched. Acceptance criteria are
 *  edited as part of `body` (the `## Acceptance criteria` checklist), the on-disk source
 *  of truth, so there is no separate criteria field. */
export interface UpdateLoopRequest {
  body?: string;
  model?: string;
  role?: string;
}

export interface Ok {
  ok: true;
}

export type GetAdrsResponse = AdrDoc[];
export type GetAdrResponse = AdrDoc;

/** PUT /api/adrs/:relPath — the full ADR document to persist. */
export type PutAdrRequest = AdrDoc;
export type PutAdrResponse = Ok;

/** POST /api/adrs/:relPath/move — `:relPath` is the source; `to` is the destination
 *  path (both databank-prefixed). Serves file move, file rename, and folder move. */
export interface MoveAdrRequest {
  to: string;
}
export type MoveAdrResponse = Ok;

/** DELETE /api/adrs/:relPath — removes a single ADR file or a whole folder subtree
 *  (databank-prefixed path). Empty parent dirs are pruned. */
export type DeleteAdrResponse = Ok;

export interface AdrDiffResponse {
  before: string;
  after: string;
}

export type GetWorkflowsResponse = WorkflowDef[];
export type GetRolesResponse = RoleDef[];
export type GetCascadesResponse = CascadeSummary[];

export interface CreateCascadeRequest {
  workflowId: string;
}
export type CreateCascadeResponse = CascadeSummary;

export interface CascadeDetail {
  summary: CascadeSummary;
  loops: LoopDoc[];
}
export type GetCascadeResponse = CascadeDetail;

export type ApproveCascadeResponse = Ok;

/** PATCH /api/cascades/:id/loops/:loopId — the persisted loop after the edit. */
export type UpdateLoopResponse = LoopDoc;

export type GetModelsResponse = ModelOption[];
/** POST /api/assistant/stream — streaming, multi-turn, agentic assistant. */
export type AssistantStreamRequestBody = AssistantChatRequest;

/** Events pushed over WS while a cascade runs. */
export type CascadeStreamEvent =
  | { type: 'loop-update'; loop: LoopDoc }
  | { type: 'output'; loopId: string; chunk: string };

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
  listCascades(): Promise<GetCascadesResponse>;
  /** Configured model aliases for the picker (no API keys). */
  listModels(): Promise<GetModelsResponse>;
  /** Streaming agentic assistant: emits events as it thinks/acts; auto-applies writes. */
  assistantStream(req: AssistantChatRequest, onEvent: (e: AssistantStreamEvent) => void, signal?: AbortSignal): Promise<void>;
  createCascade(req: CreateCascadeRequest): Promise<CreateCascadeResponse>;
  getCascade(id: string): Promise<GetCascadeResponse>;
  approveCascade(id: string): Promise<ApproveCascadeResponse>;
  /** Edit a not-yet-executing loop's plan/model/role. Rejects (409) once it has begun. */
  updateLoop(cascadeId: string, loopId: string, patch: UpdateLoopRequest): Promise<UpdateLoopResponse>;
}
