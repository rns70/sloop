import type {
  EvalResult,
  FileDiff,
  GitStatus,
  HistoryEntry,
  LoopDoc,
  LoopRun,
  WorkspaceSummary
} from "../shared/types";

type JsonBody = Record<string, unknown> | unknown[];
interface EvalRequestOptions {
  sourcePath?: string;
  criteria?: unknown[];
  commands?: unknown[];
  spec?: unknown;
}

export interface RunStateResponse {
  id: string;
  status: "paused" | "running";
  run?: LoopRun;
  doc?: LoopDoc;
  history?: HistoryEntry;
}

function isUnavailableError(error: unknown): boolean {
  return error instanceof Error && /404|405|not found|cannot (get|post)/i.test(error.message);
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers
    }
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return (await response.json()) as T;
}

async function requestOptionalJson<T>(path: string, init?: RequestInit): Promise<T | undefined> {
  try {
    return await requestJson<T>(path, init);
  } catch (error) {
    if (isUnavailableError(error)) {
      return undefined;
    }

    throw error;
  }
}

async function readApiError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.length > 0) {
      return payload.error;
    }
  } catch {
    // Fall back to status text when the server does not return JSON.
  }

  return `Request failed with ${response.status} ${response.statusText}`;
}

function jsonInit(method: "POST" | "PUT", body?: JsonBody): RequestInit {
  return {
    method,
    body: body === undefined ? undefined : JSON.stringify(body)
  };
}

function docPath(path: string): string {
  return `/api/docs/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function createSampleWorkspace(): Promise<WorkspaceSummary> {
  return requestJson<WorkspaceSummary>("/api/sample-workspace", jsonInit("POST"));
}

export function getWorkspace(): Promise<WorkspaceSummary> {
  return requestJson<WorkspaceSummary>("/api/workspace");
}

export function listDocs(): Promise<LoopDoc[]> {
  return requestJson<LoopDoc[]>("/api/docs");
}

export function getDoc(path: string): Promise<LoopDoc> {
  return requestJson<LoopDoc>(docPath(path));
}

export function saveDoc(
  path: string,
  input: Pick<LoopDoc, "frontmatter" | "body">
): Promise<LoopDoc> {
  return requestJson<LoopDoc>(docPath(path), jsonInit("PUT", input));
}

export function getGitStatus(): Promise<GitStatus> {
  return requestJson<GitStatus>("/api/git/status");
}

export function getGitDiff(): Promise<FileDiff[]> {
  return requestJson<FileDiff[]>("/api/git/diff");
}

export function runPiCascade(sourcePath: string, model?: string): Promise<LoopRun> {
  return requestJson<LoopRun>("/api/runs/pi-cascade", jsonInit("POST", { sourcePath, model }));
}

export function listRuns(): Promise<LoopRun[] | undefined> {
  return requestOptionalJson<LoopRun[]>("/api/runs");
}

export function createRun(sourcePath: string, model?: string): Promise<LoopRun | undefined> {
  return requestOptionalJson<LoopRun>("/api/runs", jsonInit("POST", { sourcePath, model }));
}

export function pauseRun(
  runId: string,
  sourcePath?: string
): Promise<RunStateResponse | undefined> {
  return requestOptionalJson<RunStateResponse>(
    "/api/runs/pause",
    jsonInit("POST", { runId, sourcePath })
  );
}

export function resumeRun(
  runId: string,
  sourcePath?: string
): Promise<RunStateResponse | undefined> {
  return requestOptionalJson<RunStateResponse>(
    "/api/runs/resume",
    jsonInit("POST", { runId, sourcePath })
  );
}

export function runEval(
  changedFiles: string[],
  input: EvalRequestOptions = {}
): Promise<EvalResult | undefined> {
  return requestOptionalJson<EvalResult>("/api/eval", jsonInit("POST", { changedFiles, ...input }));
}

export function getHistory(): Promise<HistoryEntry[]> {
  return requestJson<HistoryEntry[]>("/api/history");
}
