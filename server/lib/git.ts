import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { FileDiff, GitStatus } from "../../src/shared/types.js";

const execFileAsync = promisify(execFile);

async function git(workspaceRoot: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: workspaceRoot });
    return stdout;
  } catch {
    return "";
  }
}

export async function getGitStatus(workspaceRoot: string): Promise<GitStatus> {
  const branch = (await git(workspaceRoot, ["branch", "--show-current"])).trim() || "no-git";
  const status = await git(workspaceRoot, ["status", "--short"]);
  const files = status
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    branch,
    dirty: files.length > 0,
    files
  };
}

export async function getGitDiff(workspaceRoot: string): Promise<FileDiff[]> {
  const diff = await git(workspaceRoot, ["diff", "--", "*.md"]);
  const files: FileDiff[] = [];
  let current: FileDiff | undefined;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git")) {
      const path = line.match(/ b\/(.+)$/)?.[1] ?? "unknown";
      current = { path, lines: [] };
      files.push(current);
    } else if (current && line.startsWith("+") && !line.startsWith("+++")) {
      current.lines.push({ type: "add", text: line.slice(1) });
    } else if (current && line.startsWith("-") && !line.startsWith("---")) {
      current.lines.push({ type: "remove", text: line.slice(1) });
    } else if (current && line.startsWith(" ")) {
      current.lines.push({ type: "context", text: line.slice(1) });
    }
  }

  const untracked = (await git(workspaceRoot, ["status", "--porcelain", "--untracked-files=all"]))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("?? ") && line.endsWith(".md"))
    .map((line) => line.slice(3));

  for (const path of untracked) {
    try {
      const content = await readFile(`${workspaceRoot}/${path}`, "utf8");
      files.push({
        path,
        lines: content.split("\n").map((text) => ({ type: "add", text }))
      });
    } catch {
      // Ignore untracked files that disappear between status and read.
    }
  }

  return files;
}
