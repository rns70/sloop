import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import type {
  AgentAdapter,
  AgentRunInput,
  EvalCriteria,
  FileDiff,
  LoopDoc,
  LoopRun
} from "../../src/shared/types.js";
import { planCascade } from "./cascade.js";
import { runEvaluation } from "./evaluation.js";
import { listDocs, workspaceDiff } from "./workspace.js";

const execFileAsync = promisify(execFile);
const DEFAULT_PI_MODEL = "openai-codex/gpt-5.3-codex";

export interface PiRuntimeOptions {
  command?: string;
  args?: string[];
  model?: string;
  provider?: string;
  sessionDir?: string;
}

export interface PiPromptContext {
  workspaceRoot: string;
  sourcePath: string;
  affectedDocs: Array<Pick<LoopDoc, "path" | "title" | "evals">>;
  currentDiffSummary: string;
  evalCriteria: string[];
}

interface PiProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

interface PiLoopRun extends LoopRun {
  logs: {
    stdout: string;
    stderr: string;
  };
}

function defaultPiCommand(workspaceRoot: string): string {
  const localPi = join(workspaceRoot, "node_modules", ".bin", "pi");
  return existsSync(localPi) ? localPi : "pi";
}

function unique(paths: string[]): string[] {
  return Array.from(new Set(paths.map((path) => path.trim()).filter(Boolean))).sort();
}

function formatEvalCriteria(criteria: EvalCriteria[], docPath: string): string[] {
  return criteria.map((criterion) => `${docPath}: ${criterion.text}`);
}

function summarizeDiff(diff: FileDiff): string {
  const adds = diff.lines.filter((line) => line.type === "add").length;
  const removes = diff.lines.filter((line) => line.type === "remove").length;
  const excerpts = diff.lines
    .filter((line) => line.type !== "context")
    .slice(0, 8)
    .map((line) => {
      const prefix = line.type === "add" ? "+" : "-";
      return `    ${prefix} ${line.text}`;
    });

  return [`- ${diff.path} (${adds} additions, ${removes} removals)`, ...excerpts].join("\n");
}

function summarizeDiffs(diffs: FileDiff[]): string {
  if (diffs.length === 0) {
    return "No current Markdown diff was detected.";
  }

  return diffs.map(summarizeDiff).join("\n\n");
}

async function gitMarkdownChangedFiles(workspaceRoot: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["status", "--porcelain", "--untracked-files=all"],
      { cwd: workspaceRoot }
    );
    return unique(
      stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.slice(3))
        .filter((path) => path.endsWith(".md"))
    );
  } catch {
    return [];
  }
}

async function readWorkspaceFile(workspaceRoot: string, path: string): Promise<string | undefined> {
  try {
    return await readFile(join(workspaceRoot, path), "utf8");
  } catch {
    return undefined;
  }
}

async function snapshotFiles(
  workspaceRoot: string,
  paths: string[]
): Promise<Map<string, string | undefined>> {
  const snapshot = new Map<string, string | undefined>();
  await Promise.all(
    unique(paths).map(async (path) => {
      snapshot.set(path, await readWorkspaceFile(workspaceRoot, path));
    })
  );
  return snapshot;
}

function commandUsesShell(command: string, options: PiRuntimeOptions): boolean {
  return !options.command && /\s/.test(command);
}

function splitArgs(value: string | undefined): string[] {
  if (!value?.trim()) return [];

  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  let escaping = false;

  for (const char of value) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) quote = undefined;
      else current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) args.push(current);
  return args;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}

function pushFlagValue(args: string[], flag: string, value: string | undefined): void {
  if (!value || hasFlag(args, flag)) return;
  args.push(flag, value);
}

async function buildPiArgs(
  input: AgentRunInput,
  runId: string,
  options: PiRuntimeOptions
): Promise<string[]> {
  const args = options.args ? [...options.args] : splitArgs(process.env.SLOOP_PI_ARGS);
  if (args.length === 0) args.push("--print");
  if (!hasFlag(args, "--print") && !hasFlag(args, "-p")) args.unshift("--print");
  if (!hasFlag(args, "--approve") && !hasFlag(args, "-a") && !hasFlag(args, "--no-approve") && !hasFlag(args, "-na")) {
    args.push("--approve");
  }

  pushFlagValue(args, "--provider", options.provider ?? process.env.SLOOP_PI_PROVIDER);
  pushFlagValue(args, "--model", options.model ?? process.env.SLOOP_PI_MODEL ?? DEFAULT_PI_MODEL);

  const usesSession =
    hasFlag(args, "--session-dir") ||
    hasFlag(args, "--session") ||
    hasFlag(args, "--session-id") ||
    hasFlag(args, "--continue") ||
    hasFlag(args, "-c") ||
    hasFlag(args, "--resume") ||
    hasFlag(args, "-r") ||
    hasFlag(args, "--no-session");

  if (!usesSession) {
    const configuredSessionRoot = process.env.SLOOP_PI_SESSION_ROOT;
    const sessionRoot = configuredSessionRoot
      ? isAbsolute(configuredSessionRoot)
        ? configuredSessionRoot
        : join(input.workspaceRoot, configuredSessionRoot)
      : join(input.workspaceRoot, ".sloop", "pi-sessions");
    const sessionDir =
      options.sessionDir ??
      join(sessionRoot, runId);
    await mkdir(sessionDir, { recursive: true });
    args.push("--session-dir", sessionDir, "--session-id", runId, "--name", `Sloop ${input.sourcePath}`);
  }

  return args;
}

async function runPiCommand(
  input: AgentRunInput,
  runId: string,
  prompt: string,
  options: PiRuntimeOptions
): Promise<PiProcessResult> {
  const command = options.command ?? process.env.SLOOP_PI_COMMAND ?? defaultPiCommand(input.workspaceRoot);
  const args = await buildPiArgs(input, runId, options);

  return await new Promise<PiProcessResult>((resolve) => {
    const child = spawn(command, args, {
      cwd: input.workspaceRoot,
      stdio: ["pipe", "pipe", "pipe"],
      shell: commandUsesShell(command, options)
    });
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      resolve({
        exitCode: null,
        stdout,
        stderr,
        error: error instanceof Error ? error.message : String(error)
      });
    });
    child.on("exit", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });

    child.stdin?.end(prompt);
  });
}

export async function buildPiPromptContext(input: AgentRunInput): Promise<PiPromptContext> {
  const [docs, diffs] = await Promise.all([
    listDocs(input.workspaceRoot),
    workspaceDiff(input.workspaceRoot)
  ]);
  const sourceDiffs = diffs.filter((diff) => diff.path === input.sourcePath);
  const changedPaths = sourceDiffs.length > 0 ? sourceDiffs.map((diff) => diff.path) : [input.sourcePath];
  const plan = planCascade({
    docs,
    sourcePath: input.sourcePath,
    changedPaths
  });
  const sourceDoc = docs.find((doc) => doc.path === input.sourcePath);
  const affectedDocs = plan.affectedDocs.map((doc) => ({
    path: doc.path,
    title: doc.title,
    evals: doc.evals
  }));
  const evalCriteria = [
    ...(sourceDoc ? formatEvalCriteria(sourceDoc.evals, sourceDoc.path) : []),
    ...plan.affectedDocs.flatMap((doc) => formatEvalCriteria(doc.evals, doc.path))
  ];

  return {
    workspaceRoot: input.workspaceRoot,
    sourcePath: input.sourcePath,
    affectedDocs,
    currentDiffSummary: summarizeDiffs(sourceDiffs),
    evalCriteria
  };
}

export function createPiPrompt(context: PiPromptContext): string {
  const affectedDocs =
    context.affectedDocs.length > 0
      ? context.affectedDocs
          .map((doc) => {
            const criteria =
              doc.evals.length > 0
                ? doc.evals.map((criterion) => `    - ${criterion.text}`).join("\n")
                : "    - No explicit criteria in this downstream doc.";
            return `- ${doc.path} (${doc.title})\n${criteria}`;
          })
          .join("\n")
      : "- No affected downstream docs were found. Do not edit unrelated docs.";

  const evalCriteria =
    context.evalCriteria.length > 0
      ? context.evalCriteria.map((criterion) => `- ${criterion}`).join("\n")
      : "- No explicit eval criteria were found. Preserve existing loop intent and Markdown structure.";

  return [
    "You are Pi, the only agent runtime for Sloop.",
    "",
    `Workspace root: ${context.workspaceRoot}`,
    `Source doc path: ${context.sourcePath}`,
    "",
    "Affected downstream docs:",
    affectedDocs,
    "",
    "Current diff summary:",
    context.currentDiffSummary,
    "",
    "Evaluation criteria:",
    evalCriteria,
    "",
    "Instructions:",
    "- Update only the affected downstream docs listed above.",
    "- Do not edit unrelated files, package files, tests, or docs outside the affected downstream set.",
    "- Keep Markdown/frontmatter structure intact.",
    "- Make the smallest changes needed for the downstream docs to reflect the source diff and pass the evaluation criteria."
  ].join("\n");
}

export function createPiAgentAdapter(options: PiRuntimeOptions = {}): AgentAdapter {
  return {
    runtime: "pi",
    async run(input: AgentRunInput): Promise<LoopRun> {
      const runId = input.runId ?? `pi-${Date.now()}`;
      const context = await buildPiPromptContext(input);
      const prompt = input.prompt ?? createPiPrompt(context);
      const beforeFiles = unique([
        ...context.affectedDocs.map((doc) => doc.path),
        ...(await gitMarkdownChangedFiles(input.workspaceRoot))
      ]);
      const before = await snapshotFiles(input.workspaceRoot, beforeFiles);
      const result = await runPiCommand(input, runId, prompt, options);
      const afterFiles = unique([
        ...beforeFiles,
        ...(await gitMarkdownChangedFiles(input.workspaceRoot))
      ]);
      const after = await snapshotFiles(input.workspaceRoot, afterFiles);
      const changedFiles = afterFiles.filter((path) => before.get(path) !== after.get(path));

      const evalResult =
        result.exitCode === 0
          ? changedFiles.length === 0
            ? {
                status: "passed" as const,
                evidence: ["Pi completed successfully and reported no file changes were needed."]
              }
            : runEvaluation({ runtime: "pi", changedFiles })
          : {
              status: "failed" as const,
              evidence: [
                result.error
                  ? `Pi runtime failed to start: ${result.error}`
                  : `Pi runtime exited with code ${result.exitCode ?? "unknown"}.`
              ]
            };

      const run: PiLoopRun = {
        id: runId,
        runtime: "pi",
        sourcePath: input.sourcePath,
        status: evalResult.status,
        changedFiles,
        eval: evalResult,
        logs: {
          stdout: result.stdout,
          stderr: result.stderr
        }
      };

      return run;
    }
  };
}
