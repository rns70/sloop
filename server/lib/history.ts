import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HistoryEntry } from "../../src/shared/types.js";

const historyPath = (workspaceRoot: string) => join(workspaceRoot, ".sloop/history.json");

export async function readHistory(workspaceRoot: string): Promise<HistoryEntry[]> {
  try {
    return JSON.parse(await readFile(historyPath(workspaceRoot), "utf8")) as HistoryEntry[];
  } catch {
    return [];
  }
}

export async function appendHistory(workspaceRoot: string, entry: HistoryEntry): Promise<void> {
  const history = await readHistory(workspaceRoot);
  await mkdir(join(workspaceRoot, ".sloop"), { recursive: true });
  await writeFile(historyPath(workspaceRoot), JSON.stringify([entry, ...history], null, 2), "utf8");
}
