import { copyFile, lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { appendHistory } from "./history.js";

export interface ApplyWorktreeChangesInput {
  workspaceRoot: string;
  worktreePath: string;
  changedFiles: string[];
}

export interface ApplyWorktreeChangesResult {
  appliedFiles: string[];
  skippedFiles: string[];
}

export interface ArchiveWorktreeRunInput {
  workspaceRoot: string;
  runId: string;
  worktreePath: string;
  branch?: string;
  sourcePath?: string;
  changedFiles?: string[];
  reason?: string;
}

export interface ArchiveWorktreeRunResult {
  markerPath: string;
  worktreePath: string;
  branch?: string;
  changedFiles: string[];
}

interface ArchiveMarker {
  runId: string;
  archivedAt: string;
  worktreePath: string;
  branch?: string;
  sourcePath?: string;
  changedFiles: string[];
  reason?: string;
}

function sanitizeFileSegment(value: string): string {
  const segment = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return segment || "run";
}

function isWithin(parent: string, child: string): boolean {
  const childRelative = relative(parent, child);
  return Boolean(childRelative) && !childRelative.startsWith("..") && !childRelative.includes(`..${sep}`);
}

function normalizeRepoPath(path: string): string | undefined {
  const normalized = path.replace(/\\/g, "/").trim();
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.split("/").includes(".") ||
    normalized.split("/").includes("..")
  ) {
    return undefined;
  }

  return normalized;
}

export async function applyWorktreeChanges(
  input: ApplyWorktreeChangesInput
): Promise<ApplyWorktreeChangesResult> {
  const workspaceRoot = resolve(input.workspaceRoot);
  const worktreePath = resolve(input.worktreePath);
  const appliedFiles: string[] = [];
  const skippedFiles: string[] = [];

  for (const changedFile of input.changedFiles) {
    const repoPath = normalizeRepoPath(changedFile);
    if (!repoPath) {
      skippedFiles.push(changedFile);
      continue;
    }

    const sourcePath = resolve(worktreePath, repoPath);
    const destinationPath = resolve(workspaceRoot, repoPath);
    if (!isWithin(worktreePath, sourcePath) || !isWithin(workspaceRoot, destinationPath)) {
      skippedFiles.push(changedFile);
      continue;
    }

    try {
      const stats = await lstat(sourcePath);
      if (stats.isFile()) {
        await mkdir(dirname(destinationPath), { recursive: true });
        await copyFile(sourcePath, destinationPath);
        appliedFiles.push(repoPath);
        continue;
      }

      skippedFiles.push(changedFile);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        await rm(destinationPath, { force: true });
        appliedFiles.push(repoPath);
      } else {
        skippedFiles.push(changedFile);
      }
    }
  }

  return {
    appliedFiles,
    skippedFiles
  };
}

export async function archiveWorktreeRun(
  input: ArchiveWorktreeRunInput
): Promise<ArchiveWorktreeRunResult> {
  const workspaceRoot = resolve(input.workspaceRoot);
  const worktreePath = resolve(input.worktreePath);
  const changedFiles = [...(input.changedFiles ?? [])];
  const archivedAt = new Date().toISOString();
  const markerPath = join(
    workspaceRoot,
    ".sloop",
    "archives",
    `${sanitizeFileSegment(input.runId)}.json`
  );
  const marker: ArchiveMarker = {
    runId: input.runId,
    archivedAt,
    worktreePath,
    branch: input.branch,
    sourcePath: input.sourcePath,
    changedFiles,
    reason: input.reason
  };

  await mkdir(dirname(markerPath), { recursive: true });
  await writeFile(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  await appendHistory(workspaceRoot, {
    id: input.runId,
    kind: "archive",
    title: `Archived run ${input.runId}`,
    createdAt: archivedAt,
    sourcePath: input.sourcePath,
    changedFiles,
    status: "archived",
    summary: input.reason ?? `Archived worktree at ${worktreePath}`
  });

  return {
    markerPath,
    worktreePath,
    branch: input.branch,
    changedFiles
  };
}
