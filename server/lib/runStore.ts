import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DocStatus, EvalResult, LoopRun, StoredLoopRun } from "../../src/shared/types.js";

const runsPath = (workspaceRoot: string) => join(workspaceRoot, ".sloop/runs.json");

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asEvalResult(value: unknown): EvalResult {
  if (!isRecord(value)) {
    return { status: "failed", evidence: [] };
  }

  return {
    status: value.status === "passed" ? "passed" : "failed",
    evidence: asStringArray(value.evidence)
  };
}

function normalizeRun(value: unknown): StoredLoopRun | undefined {
  if (!isRecord(value)) return undefined;

  const id = asString(value.id);
  const sourcePath = asString(value.sourcePath);
  if (!id || !sourcePath) return undefined;

  const createdAt = asString(value.createdAt, new Date().toISOString());
  const updatedAt = asString(value.updatedAt, createdAt);

  return {
    id,
    runtime: "pi",
    sourcePath,
    status: asString(value.status, "idle") as DocStatus,
    worktreePath: asOptionalString(value.worktreePath),
    branchName: asOptionalString(value.branchName),
    changedFiles: asStringArray(value.changedFiles),
    eval: asEvalResult(value.eval),
    createdAt,
    updatedAt,
    archived: asBoolean(value.archived, false),
    log: asStringArray(value.log)
  };
}

export async function readRuns(workspaceRoot: string): Promise<StoredLoopRun[]> {
  try {
    const parsed = JSON.parse(await readFile(runsPath(workspaceRoot), "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((run) => {
      const normalized = normalizeRun(run);
      return normalized ? [normalized] : [];
    });
  } catch {
    return [];
  }
}

export async function writeRuns(workspaceRoot: string, runs: StoredLoopRun[]): Promise<void> {
  await mkdir(join(workspaceRoot, ".sloop"), { recursive: true });
  await writeFile(runsPath(workspaceRoot), JSON.stringify(runs, null, 2), "utf8");
}

export async function upsertRun(
  workspaceRoot: string,
  run: LoopRun | StoredLoopRun
): Promise<StoredLoopRun> {
  const runs = await readRuns(workspaceRoot);
  const existing = runs.find((candidate) => candidate.id === run.id);
  const now = new Date().toISOString();
  const stored: StoredLoopRun = {
    ...existing,
    ...run,
    createdAt: "createdAt" in run ? run.createdAt : existing?.createdAt ?? now,
    updatedAt: now,
    archived: ("archived" in run ? run.archived : existing?.archived) ?? false,
    log: ("log" in run ? run.log : existing?.log) ?? []
  };

  await writeRuns(
    workspaceRoot,
    existing
      ? runs.map((candidate) => (candidate.id === stored.id ? stored : candidate))
      : [stored, ...runs]
  );

  return stored;
}

export async function getRun(
  workspaceRoot: string,
  runId: string
): Promise<StoredLoopRun | undefined> {
  const runs = await readRuns(workspaceRoot);
  return runs.find((run) => run.id === runId);
}

export async function updateRunStatus(
  workspaceRoot: string,
  runId: string,
  status: DocStatus
): Promise<StoredLoopRun | undefined> {
  const run = await getRun(workspaceRoot, runId);
  if (!run) return undefined;
  return upsertRun(workspaceRoot, { ...run, status });
}

export async function appendRunLog(
  workspaceRoot: string,
  runId: string,
  line: string
): Promise<StoredLoopRun | undefined> {
  const run = await getRun(workspaceRoot, runId);
  if (!run) return undefined;
  return upsertRun(workspaceRoot, { ...run, log: [...run.log, line] });
}
