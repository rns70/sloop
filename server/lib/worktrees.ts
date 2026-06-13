import { execFile } from "node:child_process";
import { copyFile, lstat, mkdir, rm } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_BRANCH_PREFIX = "sloop/run";
const CODE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".md",
  ".mjs",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".ts",
  ".tsx",
  ".txt",
  ".yml",
  ".yaml"
]);

export interface GitWorktreeResult {
  stdout: string;
  stderr: string;
}

export interface RunWorktree {
  path: string;
  branch: string;
}

export interface WorktreeDiffCapture {
  changedFiles: string[];
  diffSummary: string;
}

function sanitizeBranchSegment(value: string): string {
  const segment = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return segment || "run";
}

function safeRunIdSegment(runId: string): string {
  return sanitizeBranchSegment(runId);
}

function assertSafeWorktreePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) throw new Error("Worktree path is required.");

  const resolved = resolve(trimmed);
  if (basename(resolved) === ".git") {
    throw new Error("Refusing to operate on a .git directory as a worktree path.");
  }

  return resolved;
}

function assertSafeGitRef(ref: string, label: string): string {
  const trimmed = ref.trim();
  const valid =
    /^[a-zA-Z0-9][a-zA-Z0-9._/-]*[a-zA-Z0-9]$/.test(trimmed) &&
    !trimmed.includes("..") &&
    !trimmed.includes("//") &&
    !trimmed.includes("@{") &&
    !trimmed.endsWith(".lock");

  if (!valid) throw new Error(`Unsafe git ${label}: ${ref}`);
  return trimmed;
}

function extensionOf(path: string): string {
  const dotIndex = path.lastIndexOf(".");
  return dotIndex >= 0 ? path.slice(dotIndex).toLowerCase() : "";
}

function isMarkdownOrCodeFile(path: string): boolean {
  return CODE_EXTENSIONS.has(extensionOf(path));
}

function isSafeRelativeRepoPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").trim();
  return (
    Boolean(normalized) &&
    !normalized.startsWith("/") &&
    !normalized.split("/").includes("..") &&
    !normalized.split("/").includes(".")
  );
}

function isWithin(parent: string, child: string): boolean {
  const childRelative = relative(parent, child);
  return Boolean(childRelative) && !childRelative.startsWith("..") && !childRelative.includes(`..${sep}`);
}

async function git(workspaceRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: workspaceRoot,
    encoding: "utf8"
  });
  return stdout;
}

function parseStatusPath(line: string): { statusCode: string; path: string } | undefined {
  if (line.length < 4) return undefined;

  const statusCode = line.slice(0, 2);
  const rawPath = line.slice(3).trim();
  const path = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) : rawPath;
  if (!path) return undefined;

  return { statusCode, path };
}

async function copyWorkingTreeDelta(workspaceRoot: string, worktreePath: string): Promise<void> {
  const root = resolve(workspaceRoot);
  const targetRoot = resolve(worktreePath);
  const status = await git(root, ["status", "--porcelain", "--untracked-files=all"]);

  await Promise.all(
    status
      .split("\n")
      .map(parseStatusPath)
      .filter((entry): entry is { statusCode: string; path: string } => Boolean(entry))
      .map(async ({ statusCode, path }) => {
        if (!isSafeRelativeRepoPath(path)) return;

        const sourcePath = resolve(root, path);
        const destinationPath = resolve(targetRoot, path);
        if (!isWithin(root, sourcePath) || !isWithin(targetRoot, destinationPath)) return;

        if (statusCode === "D " || statusCode === " D") {
          await rm(destinationPath, { force: true, recursive: true });
          return;
        }

        try {
          const stats = await lstat(sourcePath);
          if (!stats.isFile()) return;

          await mkdir(dirname(destinationPath), { recursive: true });
          await copyFile(sourcePath, destinationPath);
        } catch {
          // Ignore files that disappear while seeding the run worktree.
        }
      })
  );
}

export function createRunBranchName(
  runId: string,
  sourcePath: string,
  prefix = DEFAULT_BRANCH_PREFIX
): string {
  const safePrefix =
    prefix
      .split("/")
      .map(sanitizeBranchSegment)
      .filter(Boolean)
      .join("/") || DEFAULT_BRANCH_PREFIX;
  const safeRunId = sanitizeBranchSegment(runId);
  const safeSource = sanitizeBranchSegment(sourcePath);

  return `${safePrefix}/${safeRunId}-${safeSource}`;
}

export async function createRunWorktree(
  workspaceRoot: string,
  runId: string,
  sourcePath: string
): Promise<RunWorktree> {
  const root = resolve(workspaceRoot);
  const safeRunId = safeRunIdSegment(runId);
  const worktreePath = join(root, ".sloop", "worktrees", safeRunId);
  const branch = createRunBranchName(runId, sourcePath);

  await mkdir(dirname(worktreePath), { recursive: true });
  await addWorktree(root, worktreePath, branch);
  await copyWorkingTreeDelta(root, worktreePath);
  return { path: worktreePath, branch };
}

export async function addWorktree(
  workspaceRoot: string,
  worktreePath: string,
  branchName: string,
  startPoint = "HEAD"
): Promise<GitWorktreeResult> {
  const { stdout, stderr } = await execFileAsync(
    "git",
    [
      "worktree",
      "add",
      "-b",
      assertSafeGitRef(branchName, "branch name"),
      assertSafeWorktreePath(worktreePath),
      assertSafeGitRef(startPoint, "start point")
    ],
    { cwd: workspaceRoot, encoding: "utf8" }
  );

  return { stdout, stderr };
}

export async function captureWorktreeDiff(worktreePath: string): Promise<WorktreeDiffCapture> {
  const root = assertSafeWorktreePath(worktreePath);
  const status = await git(root, ["status", "--porcelain", "--untracked-files=all"]);
  const diffStat = (await git(root, ["diff", "--stat", "HEAD", "--"])).trim();
  const changedFiles = new Set<string>();
  const statusSummary: string[] = [];

  for (const line of status.split("\n")) {
    const parsed = parseStatusPath(line);
    if (!parsed) continue;

    const { statusCode } = parsed;
    const renamedPath = parsed.path;
    if (!renamedPath || statusCode === "D " || statusCode === " D") continue;
    if (!isSafeRelativeRepoPath(renamedPath) || !isMarkdownOrCodeFile(renamedPath)) continue;

    const absolutePath = resolve(root, renamedPath);
    if (!isWithin(root, absolutePath)) continue;

    try {
      const stats = await lstat(absolutePath);
      if (stats.isFile()) {
        changedFiles.add(renamedPath);
        statusSummary.push(`${statusCode.trim() || "M"} ${renamedPath}`);
      }
    } catch {
      // Ignore paths that disappear between git status and filesystem inspection.
    }
  }

  return {
    changedFiles: [...changedFiles].sort(),
    diffSummary: [diffStat, ...statusSummary].filter(Boolean).join("\n")
  };
}

export async function removeWorktree(
  workspaceRoot: string,
  worktreePath: string,
  force = false
): Promise<GitWorktreeResult> {
  const args = ["worktree", "remove"];
  if (force) args.push("--force");
  args.push(assertSafeWorktreePath(worktreePath));

  const { stdout, stderr } = await execFileAsync("git", args, {
    cwd: workspaceRoot,
    encoding: "utf8"
  });
  return { stdout, stderr };
}

export async function cleanupWorktree(
  workspaceRoot: string,
  worktreePath: string
): Promise<GitWorktreeResult> {
  return removeWorktree(workspaceRoot, worktreePath, true);
}
