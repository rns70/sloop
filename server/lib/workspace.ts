import { readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import fg from "fast-glob";
import type { LoopDoc, WorkspaceSummary } from "../../src/shared/types.js";
import { getGitDiff, getGitStatus } from "./git.js";
import { readHistory } from "./history.js";
import { parseLoopMarkdown, serializeLoopMarkdown } from "./markdown.js";

function toPosix(path: string): string {
  return path.split("\\").join("/");
}

export async function listDocs(workspaceRoot: string): Promise<LoopDoc[]> {
  const paths = await fg(["**/*.md", "!node_modules/**", "!dist/**", "!.sloop/**"], {
    cwd: workspaceRoot,
    absolute: true,
    dot: true
  });

  const docs = await Promise.all(
    paths.map(async (absolutePath) => {
      const raw = await readFile(absolutePath, "utf8");
      return parseLoopMarkdown(toPosix(relative(workspaceRoot, absolutePath)), raw);
    })
  );

  return docs.sort((a, b) => a.path.localeCompare(b.path));
}

export async function readDoc(workspaceRoot: string, path: string): Promise<LoopDoc> {
  const raw = await readFile(join(workspaceRoot, path), "utf8");
  return parseLoopMarkdown(path, raw);
}

export async function saveDoc(
  workspaceRoot: string,
  path: string,
  frontmatter: Record<string, unknown>,
  body: string
): Promise<LoopDoc> {
  const raw = serializeLoopMarkdown(frontmatter, body);
  await writeFile(join(workspaceRoot, path), raw, "utf8");
  return parseLoopMarkdown(path, raw);
}

export async function openWorkspace(workspaceRoot: string): Promise<WorkspaceSummary> {
  const docs = await listDocs(workspaceRoot);
  return {
    root: workspaceRoot,
    docs,
    git: await getGitStatus(workspaceRoot),
    history: await readHistory(workspaceRoot)
  };
}

export async function workspaceDiff(workspaceRoot: string) {
  return getGitDiff(workspaceRoot);
}
