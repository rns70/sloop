// Typed client for the sloop HTTP/WS API. The web app imports ONLY this module to
// reach the backend — never backend service code. WP-5 extends it (and owns this file
// after WP-0); the wire types come from the shared contract, the single source of truth.

import type {
  AdrDoc, WorkflowDef, RoleDef, AssistantChatRequest, AssistantStreamEvent,
  AdrRunEvent, RunHistoryEntry,
} from '../../shared/index';
import type {
  AdrDiffResponse, AdrChangesResponse, GetAdrRunResponse, GetModelsResponse, RunStartedResponse, Ok,
} from '../../server/api/contract';

export type {
  AdrDoc, WorkflowDef, RoleDef, AcceptanceCriterion, AdrStatus, Delta,
  AssistantChatRequest, AssistantStreamEvent, ModelOption,
  AdrRunEvent, RunHistoryEntry,
} from '../../shared/index';
export type { AdrDiffResponse, AdrChangesResponse } from '../../server/api/contract';

const BASE = '/api';

/**
 * A non-2xx API response. Carries the HTTP `status` and a human-readable `detail`
 * (the server's `{ error }` field when present, else the raw body) so callers can
 * branch on the failure — e.g. surface a 409 move conflict inline rather than as a
 * generic "failed to load". `message` keeps the verbose method/path/status form so
 * existing `.catch` handlers that only read `.message` are unaffected.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let detail = body;
    try {
      const parsed: unknown = JSON.parse(body);
      if (parsed && typeof (parsed as { error?: unknown }).error === 'string') {
        detail = (parsed as { error: string }).error;
      }
    } catch {
      // body wasn't JSON — keep the raw text as the detail
    }
    throw new ApiError(
      res.status,
      detail,
      `${init?.method ?? 'GET'} ${path} -> ${res.status} ${res.statusText} ${body}`,
    );
  }
  return (await res.json()) as T;
}

const enc = encodeURIComponent;

/** Server liveness plus the active workspace root (absolute path). The shell shows the
 *  workspace's directory name so it's always clear which working dir is being edited. */
export interface HealthResponse {
  ok: boolean;
  workspace: string;
}
export const getHealth = (): Promise<HealthResponse> => http('/health');

export const getAdrs = (): Promise<AdrDoc[]> => http('/adrs');
export const getAdr = (relPath: string): Promise<AdrDoc> => http(`/adrs/${enc(relPath)}`);
export const putAdr = (relPath: string, doc: AdrDoc): Promise<Ok> =>
  http(`/adrs/${enc(relPath)}`, { method: 'PUT', body: JSON.stringify(doc) });
export const getAdrDiff = (relPath: string): Promise<AdrDiffResponse> =>
  http(`/adrs/${enc(relPath)}/diff`);
/** Lean pending-change list (relPath + delta, no file contents) for the sidebar. */
export const getAdrChanges = (): Promise<AdrChangesResponse> => http('/adrs/changes');
/** Move/rename an ADR file, or a whole folder prefix. `from`/`to` are loops-prefixed
 *  paths (e.g. `loops/auth/a.md`). Folder moves carry all descendants. */
export const moveAdr = (from: string, to: string): Promise<Ok> =>
  http(`/adrs/${enc(from)}/move`, { method: 'POST', body: JSON.stringify({ to }) });
/** Delete an ADR file, or a whole folder subtree (loops-prefixed path). */
export const deleteAdr = (relPath: string): Promise<Ok> =>
  http(`/adrs/${enc(relPath)}`, { method: 'DELETE' });

export const getWorkflows = (): Promise<WorkflowDef[]> => http('/workflows');
export const getRoles = (): Promise<RoleDef[]> => http('/roles');

/** Stamp a workflow's starter child-ADR tree onto an ADR (one child per workflow step).
 *  Idempotent server-side — re-applying skips children that already exist. Returns the
 *  updated parent ADR (with the new child links appended to `children`). */
export const applyWorkflow = (relPath: string, workflowId: string): Promise<AdrDoc> =>
  http(`/adrs/${enc(relPath)}/apply-workflow`, { method: 'POST', body: JSON.stringify({ workflowId }) });

/** Raw markdown of any workspace file (role/workflow/config), via the
 *  `GET/PUT /api/files/:relPath` bridge. Libraries reads role/workflow content from
 *  the typed getRoles/getWorkflows responses; Save round-trips through /api/files. */
export interface FileContent {
  content: string;
}
export const getFile = (relPath: string): Promise<FileContent> => http(`/files/${enc(relPath)}`);
export const putFile = (relPath: string, content: string): Promise<Ok> =>
  http(`/files/${enc(relPath)}`, { method: 'PUT', body: JSON.stringify({ content }) });
/** Delete a raw workspace file (role/workflow) or directory (a cascade). Recursive. */
export const deleteFile = (relPath: string): Promise<Ok> =>
  http(`/files/${enc(relPath)}`, { method: 'DELETE' });

/** Global assistant: configured model aliases for the picker (no keys). */
export const getModels = (): Promise<GetModelsResponse> => http('/models');

/** POST the full thread and stream agent events. Returns the completion promise + an abort fn. */
export function streamAssistant(
  req: AssistantChatRequest,
  onEvent: (e: AssistantStreamEvent) => void,
): { done: Promise<void>; abort: () => void } {
  const controller = new AbortController();
  const done = (async () => {
    const res = await fetch(`${BASE}/assistant/stream`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req), signal: controller.signal,
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j?.error) detail = String(j.error); } catch { /* non-JSON body */ }
      throw new Error(`assistant: ${detail}`);
    }
    if (!res.body) throw new Error('assistant: no response stream');
    const reader = res.body.getReader();
    try {
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split('\n\n');
        buf = frames.pop() ?? '';
        for (const frame of frames) {
          const line = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          try { onEvent(JSON.parse(line.slice(5).trim()) as AssistantStreamEvent); } catch { /* ignore partial */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  })();
  return { done, abort: () => controller.abort() };
}

/** Run an ADR + its subtree as a single agent pass. Throws ApiError(409) if a run is
 *  already active (runs are serialized). Returns the run id to subscribe to. */
export const runAdr = (relPath: string): Promise<RunStartedResponse> =>
  http(`/adrs/${enc(relPath)}/run`, { method: 'POST' });

/** The run that rehydrates this ADR's panel (active → live reconnect, else newest finished
 *  run that included it → replay), or null if the ADR was never run. */
export const getAdrRun = (relPath: string): Promise<GetAdrRunResponse> =>
  http(`/adrs/${enc(relPath)}/run`);

/** Past runs, newest first, for the history drawer. */
export const getRuns = (): Promise<RunHistoryEntry[]> => http('/runs');
export const getRun = (runId: string): Promise<RunHistoryEntry> => http(`/runs/${enc(runId)}`);

/**
 * Subscribe to an ADR run's live event stream over WebSocket.
 * Returns an unsubscribe function that closes the socket.
 */
export function subscribeToRun(
  runId: string,
  onEvent: (event: AdrRunEvent) => void,
  onError?: (err: Event) => void,
): () => void {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${window.location.host}${BASE}/runs/${enc(runId)}/stream`;
  const ws = new WebSocket(url);
  ws.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data as string) as AdrRunEvent);
    } catch {
      // Ignore malformed frames; the contract guarantees JSON, this is defense-in-depth.
    }
  };
  if (onError) ws.onerror = onError;
  return () => ws.close();
}
