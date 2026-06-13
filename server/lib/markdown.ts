import matter from "gray-matter";
import type { EvalCriteria, LoopDoc, LoopMetadata, LoopStage } from "../../src/shared/types.js";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean)
    : [];
}

function titleFromBody(body: string, fallback: string): string {
  const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return title || fallback;
}

function stageControllerPath(id: string): string {
  return `loops/build/${id}.md`;
}

function normalizeStages(value: unknown): LoopStage[] {
  if (!Array.isArray(value)) return [];

  return value.map((stage, index) => {
    const record = asRecord(stage);
    const kind = record.kind === "code" ? "code" : "doc";
    const titleFallback = kind === "code" ? `Code stage ${index + 1}` : `Stage ${index + 1}`;
    const rawTitle = asString(record.title, asString(record.doc, titleFallback));
    const id = asString(record.id, rawTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
    const doc = asString(record.doc, kind === "code" ? stageControllerPath(id) : "");
    const title = asString(record.title, doc || `Stage ${index + 1}`);
    const evalRecord = asRecord(record.eval);
    return {
      id,
      kind,
      title,
      doc,
      status: asString(record.status, "idle") as LoopStage["status"],
      agent: record.agent === "pi" ? record.agent : undefined,
      outputs: asStringList(record.outputs),
      evals: normalizeEvals(record.evals),
      commands: asStringList(record.commands).concat(asStringList(evalRecord.commands))
    };
  });
}

function normalizeEvals(value: unknown): EvalCriteria[] {
  if (!Array.isArray(value)) return [];

  return value.map((entry, index) => {
    if (typeof entry === "string") {
      return {
        id: `eval-${index + 1}`,
        text: entry,
        status: "pending"
      };
    }

    const record = asRecord(entry);
    return {
      id: asString(record.id, `eval-${index + 1}`),
      text: asString(record.text, ""),
      status:
        record.status === "passed" || record.status === "failed" || record.status === "pending"
          ? record.status
          : "pending"
    };
  });
}

export function parseLoopMarkdown(path: string, raw: string): LoopDoc {
  const parsed = matter(raw);
  const frontmatter = parsed.data as Record<string, unknown>;
  const loopRecord = asRecord(frontmatter.loop);
  const stages = normalizeStages(loopRecord.stages);
  const body = parsed.content.trimStart();

  const loop: LoopMetadata = {
    id: asString(loopRecord.id, path),
    type: asString(loopRecord.type, "document"),
    status: asString(loopRecord.status, "idle") as LoopMetadata["status"],
    autoApply: asBoolean(loopRecord.autoApply, false),
    stages
  };

  return {
    path,
    title: titleFromBody(body, path.split("/").pop() || path),
    frontmatter,
    loop,
    stages,
    evals: normalizeEvals(frontmatter.evals),
    outputs: asStringList(frontmatter.outputs),
    commands: asStringList(frontmatter.commands),
    body,
    raw
  };
}

export function serializeLoopMarkdown(frontmatter: Record<string, unknown>, body: string): string {
  return matter.stringify(`${body.trim()}\n`, frontmatter).trimStart();
}
