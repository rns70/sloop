import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DocStatus, HistoryEntry, LoopDoc } from "../../src/shared/types.js";
import { appendHistory } from "./history.js";
import { parseLoopMarkdown, serializeLoopMarkdown } from "./markdown.js";

export interface LoopStateChange {
  doc: LoopDoc;
  history: HistoryEntry;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function loopWithStatus(frontmatter: Record<string, unknown>, status: DocStatus): Record<string, unknown> {
  const loop = isRecord(frontmatter.loop) ? frontmatter.loop : {};
  return {
    ...frontmatter,
    loop: {
      ...loop,
      status
    }
  };
}

async function updateLoopState(
  workspaceRoot: string,
  docPath: string,
  status: "paused" | "running"
): Promise<LoopStateChange> {
  const absolutePath = join(workspaceRoot, docPath);
  const currentRaw = await readFile(absolutePath, "utf8");
  const currentDoc = parseLoopMarkdown(docPath, currentRaw);
  const frontmatter = loopWithStatus(currentDoc.frontmatter, status);
  const nextRaw = serializeLoopMarkdown(frontmatter, currentDoc.body);

  await writeFile(absolutePath, nextRaw, "utf8");

  const history: HistoryEntry = {
    id: `${status}-${Date.now()}`,
    kind: status === "paused" ? "pause" : "resume",
    title: status === "paused" ? "Loop paused" : "Loop resumed",
    createdAt: new Date().toISOString(),
    sourcePath: docPath,
    changedFiles: [docPath],
    status,
    summary:
      status === "paused"
        ? "Loop status set to paused in frontmatter."
        : "Loop status set to running in frontmatter."
  };

  await appendHistory(workspaceRoot, history);

  return {
    doc: parseLoopMarkdown(docPath, nextRaw),
    history
  };
}

export function pauseLoop(workspaceRoot: string, docPath: string): Promise<LoopStateChange> {
  return updateLoopState(workspaceRoot, docPath, "paused");
}

export function resumeLoop(workspaceRoot: string, docPath: string): Promise<LoopStateChange> {
  return updateLoopState(workspaceRoot, docPath, "running");
}
