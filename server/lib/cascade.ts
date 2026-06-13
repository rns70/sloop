import type { FileDiff, LoopDoc, LoopStage } from "../../src/shared/types.js";

export interface CascadePlanInput {
  docs: LoopDoc[];
  sourcePath: string;
  changedPaths?: string[];
  diffs?: FileDiff[];
}

export interface CascadeAffectedDoc {
  doc: LoopDoc;
  path: string;
  reasons: string[];
  via: string[];
}

export interface CascadePlan {
  sourcePath: string;
  changedPaths: string[];
  affectedDocs: LoopDoc[];
  affected: CascadeAffectedDoc[];
}

function isActiveStage(stage: LoopStage): boolean {
  return stage.status !== "archived" && Boolean(stage.doc);
}

function normalizePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean)));
}

function describeStage(stage: LoopStage, parent: LoopDoc): string {
  return `${parent.path} -> ${stage.doc} (${stage.title || stage.id})`;
}

function addAffectedDoc(
  affectedByPath: Map<string, CascadeAffectedDoc>,
  docsByPath: Map<string, LoopDoc>,
  path: string,
  reason: string,
  via: string
): void {
  const doc = docsByPath.get(path);
  if (!doc) return;

  const current = affectedByPath.get(path);
  if (current) {
    if (!current.reasons.includes(reason)) current.reasons.push(reason);
    if (!current.via.includes(via)) current.via.push(via);
    return;
  }

  affectedByPath.set(path, {
    doc,
    path,
    reasons: [reason],
    via: [via]
  });
}

export function planCascade(input: CascadePlanInput): CascadePlan {
  const diffPaths = input.diffs?.map((diff) => diff.path) ?? [];
  const changedPaths = normalizePaths([input.sourcePath, ...(input.changedPaths ?? []), ...diffPaths]);
  const docsByPath = new Map(input.docs.map((doc) => [doc.path, doc]));
  const visitedParents = new Set<string>();
  const affectedPaths: string[] = [];
  const affectedSet = new Set<string>();
  const affectedByPath = new Map<string, CascadeAffectedDoc>();
  const queue = [...changedPaths];

  while (queue.length > 0) {
    const parentPath = queue.shift();
    if (!parentPath || visitedParents.has(parentPath)) continue;

    visitedParents.add(parentPath);
    const parent = docsByPath.get(parentPath);
    if (!parent) continue;

    for (const stage of parent.stages) {
      if (!isActiveStage(stage) || !docsByPath.has(stage.doc)) continue;
      const childPath = stage.doc;
      const via = describeStage(stage, parent);
      const relationship = changedPaths.includes(parent.path)
        ? `Direct child of changed doc ${parent.path}.`
        : `Descendant of affected doc ${parent.path}.`;
      if (!affectedSet.has(stage.doc) && !changedPaths.includes(stage.doc)) {
        affectedSet.add(childPath);
        affectedPaths.push(childPath);
      }
      if (!changedPaths.includes(childPath)) {
        addAffectedDoc(affectedByPath, docsByPath, childPath, relationship, via);
      }
      queue.push(childPath);
    }
  }

  const affected = affectedPaths.flatMap((path) => {
    const entry = affectedByPath.get(path);
    return entry ? [entry] : [];
  });

  return {
    sourcePath: input.sourcePath,
    changedPaths,
    affectedDocs: affected.map((entry) => entry.doc),
    affected
  };
}

export function summarizeAffectedDocsForPi(plan: CascadePlan): string {
  if (plan.affected.length === 0) {
    return `No downstream loop docs are affected by ${plan.changedPaths.join(", ")}.`;
  }

  const lines = [
    `Changed docs/files: ${plan.changedPaths.join(", ")}`,
    "Affected downstream docs for Pi:"
  ];

  for (const affected of plan.affected) {
    lines.push(`- ${affected.path}: ${affected.reasons.join(" ")}`);
    for (const via of affected.via) {
      lines.push(`  via ${via}`);
    }
  }

  return lines.join("\n");
}
