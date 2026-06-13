// Typed client for the sloop HTTP/WS API. The web app imports ONLY this module to
// reach the backend — never backend service code. WP-5 extends it (and owns this file
// after WP-0); the wire types come from the shared contract, the single source of truth.

import type {
  AdrDoc, TemplateDef, RoleDef, CascadeSummary, AssistantRequest,
} from '../../shared/index';
import type {
  AdrDiffResponse, AssistantResponse, GetModelsResponse,
  CascadeDetail, CascadeStreamEvent, CreateCascadeRequest, Ok,
} from '../../server/api/contract';

export type {
  AdrDoc, TemplateDef, RoleDef, CascadeSummary, LoopDoc,
  LoopFrontmatter, LoopStatus, LoopKind, Delta, AcceptanceCriterion,
  AssistantRequest, AssistantProposal, ModelOption,
} from '../../shared/index';
export type { AdrDiffResponse, CascadeDetail, CascadeStreamEvent } from '../../server/api/contract';

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
/** Move/rename an ADR file, or a whole folder prefix. `from`/`to` are databank-prefixed
 *  paths (e.g. `databank/auth/a.md`). Folder moves carry all descendants. */
export const moveAdr = (from: string, to: string): Promise<Ok> =>
  http(`/adrs/${enc(from)}/move`, { method: 'POST', body: JSON.stringify({ to }) });

export const getTemplates = (): Promise<TemplateDef[]> => http('/templates');
export const getRoles = (): Promise<RoleDef[]> => http('/roles');

/** Raw markdown of any workspace file (role/template/config), via the
 *  `GET/PUT /api/files/:relPath` bridge. Libraries reads role/template content from
 *  the typed getRoles/getTemplates responses; Save round-trips through /api/files. */
export interface FileContent {
  content: string;
}
export const getFile = (relPath: string): Promise<FileContent> => http(`/files/${enc(relPath)}`);
export const putFile = (relPath: string, content: string): Promise<Ok> =>
  http(`/files/${enc(relPath)}`, { method: 'PUT', body: JSON.stringify({ content }) });

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
