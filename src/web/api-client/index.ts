// Typed client for the sloop HTTP/WS API. The web app imports ONLY this module to
// reach the backend — never backend service code. WP-5 extends it (and owns this file
// after WP-0); the wire types come from the shared contract, the single source of truth.

import type {
  AdrDoc, TemplateDef, RoleDef, CascadeSummary, AuthorRequest, AssistantRequest,
} from '../../shared/index';
import type {
  AdrDiffResponse, AuthorResponse, AssistantResponse, GetModelsResponse,
  CascadeDetail, CascadeStreamEvent, CreateCascadeRequest, Ok,
} from '../../server/api/contract';

export type {
  AdrDoc, TemplateDef, RoleDef, CascadeSummary, LoopDoc,
  LoopFrontmatter, LoopStatus, LoopKind, Delta, AcceptanceCriterion, AuthorRequest,
  AssistantRequest, AssistantProposal, ModelOption,
} from '../../shared/index';
export type { AdrDiffResponse, AuthorResponse, CascadeDetail, CascadeStreamEvent } from '../../server/api/contract';

const BASE = '/api';

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status} ${res.statusText} ${detail}`);
  }
  return (await res.json()) as T;
}

const enc = encodeURIComponent;

export const getAdrs = (): Promise<AdrDoc[]> => http('/adrs');
export const getAdr = (relPath: string): Promise<AdrDoc> => http(`/adrs/${enc(relPath)}`);
export const putAdr = (relPath: string, doc: AdrDoc): Promise<Ok> =>
  http(`/adrs/${enc(relPath)}`, { method: 'PUT', body: JSON.stringify(doc) });
export const getAdrDiff = (relPath: string): Promise<AdrDiffResponse> =>
  http(`/adrs/${enc(relPath)}/diff`);

export const getTemplates = (): Promise<TemplateDef[]> => http('/templates');
export const getRoles = (): Promise<RoleDef[]> => http('/roles');

/** Raw markdown of any workspace file (role/template/config). Per the canonical
 *  contract (`GET/PUT /api/files/:relPath`); the mock backend wires it in WP-6.
 *  Libraries reads role/template content from the typed getRoles/getTemplates
 *  responses, so viewing works today; Save round-trips once /api/files exists. */
export interface FileContent {
  content: string;
}
export const getFile = (relPath: string): Promise<FileContent> => http(`/files/${enc(relPath)}`);
export const putFile = (relPath: string, content: string): Promise<Ok> =>
  http(`/files/${enc(relPath)}`, { method: 'PUT', body: JSON.stringify({ content }) });

/** WP-7 authoring assistant: ask the backend for a Cursor-style proposal (replacement
 *  text / edited doc / chat answer). Never writes — the editor shows it as an inline diff. */
export const requestAuthor = (req: AuthorRequest): Promise<AuthorResponse> =>
  http('/author', { method: 'POST', body: JSON.stringify(req) });

/** Global assistant: configured model aliases for the picker (no keys). */
export const getModels = (): Promise<GetModelsResponse> => http('/models');

/** Global assistant: ask for a typed proposal (answer/edit/create-*). Never writes —
 *  the rail previews it and confirms before any putAdr/putFile. */
export const requestAssistant = (req: AssistantRequest): Promise<AssistantResponse> =>
  http('/assistant', { method: 'POST', body: JSON.stringify(req) });

export const getCascades = (): Promise<CascadeSummary[]> => http('/cascades');
export const createCascade = (req: CreateCascadeRequest): Promise<CascadeSummary> =>
  http('/cascades', { method: 'POST', body: JSON.stringify(req) });
export const getCascade = (id: string): Promise<CascadeDetail> => http(`/cascades/${enc(id)}`);
export const approveCascade = (id: string): Promise<Ok> =>
  http(`/cascades/${enc(id)}/approve`, { method: 'POST' });

/**
 * Subscribe to a cascade's live event stream over WebSocket.
 * Returns an unsubscribe function that closes the socket.
 */
export function subscribeToCascade(
  id: string,
  onEvent: (event: CascadeStreamEvent) => void,
  onError?: (err: Event) => void,
): () => void {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${window.location.host}${BASE}/cascades/${enc(id)}/stream`;
  const ws = new WebSocket(url);
  ws.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data as string) as CascadeStreamEvent);
    } catch {
      // Ignore malformed frames; the contract guarantees JSON, this is defense-in-depth.
    }
  };
  if (onError) ws.onerror = onError;
  return () => ws.close();
}
