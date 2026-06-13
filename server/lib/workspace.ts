import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
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

export async function listProjectFiles(workspaceRoot: string): Promise<string[]> {
  const paths = await fg(
    ["**/*", "!node_modules/**", "!dist/**", "!.sloop/**", "!.git/**", "!coverage/**"],
    {
      cwd: workspaceRoot,
      onlyFiles: true,
      dot: true
    }
  );

  return paths.map(toPosix).sort((a, b) => a.localeCompare(b));
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
    files: await listProjectFiles(workspaceRoot),
    docs,
    git: await getGitStatus(workspaceRoot),
    history: await readHistory(workspaceRoot)
  };
}

export async function workspaceDiff(workspaceRoot: string) {
  return getGitDiff(workspaceRoot);
}

export async function assertWorkspaceDirectory(workspaceRoot: string): Promise<void> {
  let stats;
  try {
    stats = await stat(workspaceRoot);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`Workspace folder does not exist: ${workspaceRoot}`);
    }

    throw error;
  }

  if (!stats.isDirectory()) {
    throw new Error(`${workspaceRoot} is not a directory`);
  }
}

async function writeStarterDoc(path: string, contents: string): Promise<void> {
  try {
    await writeFile(path, contents, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") return;
    throw error;
  }
}

export async function createWorkspace(workspaceRoot: string): Promise<WorkspaceSummary> {
  await mkdir(join(workspaceRoot, "loops", "architecture"), { recursive: true });
  await mkdir(join(workspaceRoot, "loops", "plans"), { recursive: true });

  await writeStarterDoc(
    join(workspaceRoot, "loops", "PRD.md"),
    `---
loop:
  id: prd
  type: prd
  status: idle
  autoApply: true
  stages:
    - id: architecture
      kind: doc
      title: Architecture
      doc: loops/architecture/architecture.md
      status: idle
      agent: pi
evals:
  - Requirements are specific enough for downstream design and implementation.
---
# Product Requirements

Describe the product, constraints, and acceptance criteria.
`
  );

  await writeStarterDoc(
    join(workspaceRoot, "loops", "architecture", "architecture.md"),
    `---
loop:
  id: architecture
  type: architecture
  status: idle
  autoApply: true
  stages:
    - id: implementation-plan
      kind: doc
      title: Implementation plan
      doc: loops/plans/implementation-plan.md
      status: idle
      agent: pi
evals:
  - Architecture choices trace back to product requirements.
---
# Architecture

Describe the approach and key technical decisions.
`
  );

  await writeStarterDoc(
    join(workspaceRoot, "loops", "plans", "implementation-plan.md"),
    `---
loop:
  id: implementation-plan
  type: implementation-plan
  status: idle
  autoApply: true
  stages:
    - id: build
      kind: code
      title: Build
      doc: loops/build/build.md
      status: idle
      agent: pi
      outputs:
        - src/**
        - tests/**
      eval:
        commands:
          - npm test
evals:
  - Implementation plan is actionable and testable.
---
# Implementation Plan

Describe the concrete implementation steps and expected code outputs.
`
  );

  return openWorkspace(workspaceRoot);
}
