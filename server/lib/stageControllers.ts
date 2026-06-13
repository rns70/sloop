import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { serializeLoopMarkdown } from "./markdown.js";
import { listDocs, saveDoc } from "./workspace.js";
import type { EvalCriteria, LoopDoc, LoopStage } from "../../src/shared/types.js";

export interface StageControllerMaterialization {
  createdPaths: string[];
}

export interface DefaultCascadeMaterialization {
  createdPaths: string[];
}

function criterionText(criteria: EvalCriteria[]): string[] {
  return criteria.map((criterion) => criterion.text).filter(Boolean);
}

function controllerFrontmatter(stage: LoopStage): Record<string, unknown> {
  return {
    loop: {
      id: stage.id,
      type: "code",
      status: stage.status,
      autoApply: true,
      stages: []
    },
    outputs: stage.outputs,
    commands: stage.commands,
    evals: criterionText(stage.evals)
  };
}

function controllerBody(stage: LoopStage, parent: LoopDoc): string {
  const outputs =
    stage.outputs.length > 0
      ? stage.outputs.map((output) => `- ${output}`).join("\n")
      : "- No output paths declared.";
  const commands =
    stage.commands.length > 0
      ? stage.commands.map((command) => `- ${command}`).join("\n")
      : "- No deterministic commands declared.";

  return [
    `# ${stage.title}`,
    "",
    `Parent: ${parent.path}`,
    "",
    "## Allowed outputs",
    outputs,
    "",
    "## Eval commands",
    commands,
    ""
  ].join("\n");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function slugify(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return slug || fallback;
}

function sourceIntent(doc: LoopDoc): string {
  const meaningfulLine = doc.body
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean);

  return meaningfulLine || doc.title || doc.path;
}

async function writeLoopDoc(workspaceRoot: string, path: string, frontmatter: Record<string, unknown>, body: string) {
  const absolutePath = join(workspaceRoot, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, serializeLoopMarkdown(frontmatter, body), "utf8");
}

export async function materializeDefaultCascadeForSource(
  workspaceRoot: string,
  sourcePath: string
): Promise<DefaultCascadeMaterialization> {
  const docs = await listDocs(workspaceRoot);
  const source = docs.find((doc) => doc.path === sourcePath);
  if (!source || source.stages.length > 0 || source.outputs.length > 0 || source.commands.length > 0) {
    return { createdPaths: [] };
  }

  const intent = sourceIntent(source);
  const slug = slugify(intent, slugify(source.title, "loop"));
  const architecturePath = `loops/architecture/${slug}-architecture.md`;
  const planPath = `loops/plans/${slug}-plan.md`;
  const buildPath = `loops/build/build-${slug}.md`;
  const docsByPath = new Set(docs.map((doc) => doc.path));
  const createdPaths: string[] = [];

  const sourceLoop = asRecord(source.frontmatter.loop);
  const nextFrontmatter = {
    ...source.frontmatter,
    loop: {
      ...sourceLoop,
      id: typeof sourceLoop.id === "string" ? sourceLoop.id : `${slug}-prd`,
      type: typeof sourceLoop.type === "string" ? sourceLoop.type : "prd",
      status: typeof sourceLoop.status === "string" ? sourceLoop.status : "idle",
      autoApply: typeof sourceLoop.autoApply === "boolean" ? sourceLoop.autoApply : true,
      stages: [
        {
          id: `${slug}-architecture`,
          kind: "doc",
          title: `${intent} Architecture`,
          doc: architecturePath,
          status: "idle",
          agent: "pi"
        }
      ]
    },
    evals: Array.isArray(source.frontmatter.evals)
      ? source.frontmatter.evals
      : [`Downstream docs and implementation satisfy: ${intent}`]
  };
  await saveDoc(workspaceRoot, source.path, nextFrontmatter, source.body);

  if (!docsByPath.has(architecturePath)) {
    await writeLoopDoc(
      workspaceRoot,
      architecturePath,
      {
        loop: {
          id: `${slug}-architecture`,
          type: "architecture",
          status: "idle",
          autoApply: true,
          stages: [
            {
              id: `${slug}-plan`,
              kind: "doc",
              title: `${intent} Implementation Plan`,
              doc: planPath,
              status: "idle",
              agent: "pi"
            }
          ]
        },
        evals: [`Architecture supports the product request: ${intent}`]
      },
      [`# ${intent} Architecture`, "", `Design the system for: ${intent}`, ""].join("\n")
    );
    createdPaths.push(architecturePath);
  }

  if (!docsByPath.has(planPath)) {
    await writeLoopDoc(
      workspaceRoot,
      planPath,
      {
        loop: {
          id: `${slug}-plan`,
          type: "implementation-plan",
          status: "idle",
          autoApply: true,
          stages: [
            {
              id: `build-${slug}`,
              kind: "code",
              title: `Build ${intent}`,
              doc: buildPath,
              status: "idle",
              agent: "pi",
              outputs: ["index.html", "src/**", "tests/**"],
              eval: {
                commands: ["node tests/smoke.mjs"]
              }
            }
          ]
        },
        evals: [`Plan is actionable and leads to a working implementation for: ${intent}`]
      },
      [`# ${intent} Implementation Plan`, "", `Plan the concrete files and validation for: ${intent}`, ""].join("\n")
    );
    createdPaths.push(planPath);
  }

  if (!docsByPath.has(buildPath)) {
    await writeLoopDoc(
      workspaceRoot,
      buildPath,
      {
        loop: {
          id: `build-${slug}`,
          type: "code",
          status: "idle",
          autoApply: true,
          stages: []
        },
        outputs: ["index.html", "src/**", "tests/**"],
        commands: ["node tests/smoke.mjs"],
        evals: [`Implementation works for the product request: ${intent}`]
      },
      [
        `# Build ${intent}`,
        "",
        `Create the final implementation for: ${intent}`,
        "",
        "Allowed outputs:",
        "- index.html",
        "- src/**",
        "- tests/**",
        "",
        "Evaluation command:",
        "- node tests/smoke.mjs",
        ""
      ].join("\n")
    );
    createdPaths.push(buildPath);
  }

  return { createdPaths };
}

export async function materializeCodeStageControllers(
  workspaceRoot: string
): Promise<StageControllerMaterialization> {
  const docs = await listDocs(workspaceRoot);
  const docsByPath = new Set(docs.map((doc) => doc.path));
  const createdPaths: string[] = [];

  for (const parent of docs) {
    for (const stage of parent.stages) {
      if (stage.kind !== "code" || !stage.doc || docsByPath.has(stage.doc)) continue;

      const absolutePath = join(workspaceRoot, stage.doc);
      if (existsSync(absolutePath)) continue;

      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(
        absolutePath,
        serializeLoopMarkdown(controllerFrontmatter(stage), controllerBody(stage, parent)),
        "utf8"
      );
      docsByPath.add(stage.doc);
      createdPaths.push(stage.doc);
    }
  }

  return { createdPaths };
}
