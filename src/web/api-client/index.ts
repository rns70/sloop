// Typed client for the sloop HTTP/WS API. The web app imports ONLY this module to
// reach the backend — never backend service code. WP-5 extends it (and owns this file
// after WP-0); the wire types come from the shared contract, the single source of truth.

import type {
  AdrDoc, TemplateDef, RoleDef, CascadeSummary,
} from '../../shared/index';
import type {
  AdrDiffResponse, CascadeDetail, CascadeStreamEvent, CreateCascadeRequest, Ok,
} from '../../server/api/contract';

export type {
  AdrDoc, TemplateDef, RoleDef, CascadeSummary, LoopDoc,
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

export const getTemplates = (): Promise<TemplateDef[]> => http('/templates');
export const getRoles = (): Promise<RoleDef[]> => http('/roles');

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
