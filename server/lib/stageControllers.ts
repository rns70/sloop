import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { serializeLoopMarkdown } from "./markdown.js";
import { listDocs } from "./workspace.js";
import type { EvalCriteria, LoopDoc, LoopStage } from "../../src/shared/types.js";

export interface StageControllerMaterialization {
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
