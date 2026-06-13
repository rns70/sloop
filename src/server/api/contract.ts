// HTTP/WS API contract between the web app and the Node backend.
//
// This is the single swap point of the whole build: WP-0 ships a MOCK that
// satisfies this contract (src/server/api/mock.ts); WP-6 swaps in real handlers
// backed by the FilesService / GitService / CascadeEngine / Executor. The web
// app talks ONLY to this surface (via src/web/api-client) and never imports
// backend service code.
//
//   GET  /api/adrs                 -> AdrDoc[]
//   GET  /api/adrs/:relPath        -> AdrDoc
//   PUT  /api/adrs/:relPath        -> { ok: true }                 body: PutAdrRequest
//   GET  /api/adrs/:relPath/diff   -> AdrDiffResponse
//   GET  /api/workflows            -> WorkflowDef[]
//   GET  /api/roles                -> RoleDef[]
//   GET  /api/models               -> ModelOption[]
//   POST /api/assistant            -> AssistantProposal             body: AssistantRequestBody
//   GET  /api/cascades             -> CascadeSummary[]
//   POST /api/cascades             -> CascadeSummary               body: CreateCascadeRequest
//   GET  /api/cascades/:id         -> CascadeDetail
//   POST /api/cascades/:id/approve -> { ok: true }
//   WS   /api/cascades/:id/stream  -> CascadeStreamEvent
//
// `:relPath` is URL-encoded (it contains slashes, e.g. databank/adr-007.md).

import type {
  AdrDoc, WorkflowDef, RoleDef, CascadeSummary, LoopDoc,
  AssistantRequest, AssistantProposal, ModelOption,
} from '../../shared/index';

export interface Ok {
  ok: true;
}

export type GetAdrsResponse = AdrDoc[];
export type GetAdrResponse = AdrDoc;

/** PUT /api/adrs/:relPath — the full ADR document to persist. */
export type PutAdrRequest = AdrDoc;
export type PutAdrResponse = Ok;

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

export type GetModelsResponse = ModelOption[];
/** POST /api/assistant — global assistant (answer/edit/create-*). Returns a typed
 *  proposal the rail previews; never writes. */
export type AssistantRequestBody = AssistantRequest;
export type AssistantResponse = AssistantProposal;

/** Events pushed over WS while a cascade runs. */
export type CascadeStreamEvent =
  | { type: 'loop-update'; loop: LoopDoc }
  | { type: 'output'; loopId: string; chunk: string };

/** Shape every API backend (mock or real) implements. The HTTP/WS layer is a thin
 *  adapter over this — keeping the swap to real services a one-line construction change. */
export interface SloopApi {
  listAdrs(): Promise<GetAdrsResponse>;
  getAdr(relPath: string): Promise<GetAdrResponse>;
  putAdr(relPath: string, doc: PutAdrRequest): Promise<PutAdrResponse>;
  getAdrDiff(relPath: string): Promise<AdrDiffResponse>;
  listWorkflows(): Promise<GetWorkflowsResponse>;
  listRoles(): Promise<GetRolesResponse>;
  listCascades(): Promise<GetCascadesResponse>;
  /** Configured model aliases for the picker (no API keys). */
  listModels(): Promise<GetModelsResponse>;
  /** Global assistant: returns a typed proposal, never writes. */
  assistant(req: AssistantRequest): Promise<AssistantResponse>;
  createCascade(req: CreateCascadeRequest): Promise<CreateCascadeResponse>;
  getCascade(id: string): Promise<GetCascadeResponse>;
  approveCascade(id: string): Promise<ApproveCascadeResponse>;
  /** Ordered events to stream for a cascade's WS subscribers. Mock returns a scripted
   *  sequence; the real backend emits live as the executor runs. */
  streamEvents(id: string): Promise<CascadeStreamEvent[]>;
}
