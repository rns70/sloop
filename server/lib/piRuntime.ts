import { exec, execFile, spawn } from "node:child_process";
import fg from "fast-glob";
import { readFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import type {
  AgentAdapter,
  AgentRunInput,
  EvalCriteria,
  EvalResult,
  FileDiff,
  LoopDoc,
  LoopRun
} from "../../src/shared/types.js";
import { planCascade } from "./cascade.js";
import {
  runEvaluation,
  runStructuredEvaluation,
  type CommandExecutionResult,
  type EvaluationCommandInput,
  type EvaluationInput
} from "./evaluation.js";
import { materializeCodeStageControllers, materializeDefaultCascadeForSource } from "./stageControllers.js";
import { listDocs, workspaceDiff } from "./workspace.js";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
const DEFAULT_PI_MODEL = "openai-codex/gpt-5.3-codex";
const DEFAULT_MAX_ATTEMPTS = 3;
const CODE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".h",
  ".hpp",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".md",
  ".mjs",
  ".py",
  ".rb",
  ".rs",
  ".scss",
  ".sh",
  ".ts",
  ".tsx",
  ".txt",
  ".yml",
  ".yaml"
]);

export interface PiRuntimeOptions {
  command?: string;
  args?: string[];
  model?: string;
  provider?: string;
  sessionDir?: string;
  maxAttempts?: number;
  executor?: EvaluationInput["executor"];
}

export interface PiPromptContext {
  workspaceRoot: string;
  sourcePath: string;
  sourceDoc?: Pick<LoopDoc, "path" | "title" | "body" | "evals">;
  affectedDocs: Array<Pick<LoopDoc, "path" | "title" | "evals" | "outputs" | "commands">>;
  currentDiffSummary: string;
  evalCriteria: string[];
  evalCommands: EvaluationCommandInput[];
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

function formatEvalCommands(commands: string[], docPath: string): EvaluationCommandInput[] {
  return commands.map((command, index) => ({
    id: `${docPath}:command-${index + 1}`,
    command
  }));
}

function normalizeRepoPath(path: string): string | undefined {
  const normalized = path.replace(/\\/g, "/").trim();
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.split("/").includes(".") ||
    normalized.split("/").includes("..")
  ) {
    return undefined;
  }

  return normalized;
}

function extensionOf(path: string): string {
  const dotIndex = path.lastIndexOf(".");
  return dotIndex >= 0 ? path.slice(dotIndex).toLowerCase() : "";
}

function isMarkdownOrCodeFile(path: string): boolean {
  return CODE_EXTENSIONS.has(extensionOf(path));
}

function outputPatterns(context: PiPromptContext): string[] {
  return unique(context.affectedDocs.flatMap((doc) => doc.outputs));
}

function affectedDocPaths(context: PiPromptContext): string[] {
  return unique(context.affectedDocs.map((doc) => doc.path));
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

async function gitChangedCodeFiles(workspaceRoot: string): Promise<string[]> {
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
        .map((path) => (path.includes(" -> ") ? path.split(" -> ").at(-1) ?? path : path))
        .filter((path) => Boolean(normalizeRepoPath(path)) && isMarkdownOrCodeFile(path))
    );
  } catch {
    return [];
  }
}

async function existingOutputFiles(workspaceRoot: string, patterns: string[]): Promise<string[]> {
  if (patterns.length === 0) return [];

  return unique(
    await fg(patterns, {
      cwd: workspaceRoot,
      onlyFiles: true,
      dot: true,
      ignore: ["node_modules/**", "dist/**", ".sloop/**"]
    })
  );
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

function configuredMaxAttempts(options: PiRuntimeOptions): number {
  const raw = options.maxAttempts ?? Number(process.env.SLOOP_LOOP_MAX_ATTEMPTS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_ATTEMPTS;
}

function globMatches(path: string, pattern: string): boolean {
  const normalizedPath = path.replace(/\\/g, "/");
  const normalizedPattern = pattern.replace(/\\/g, "/").trim();

  if (!normalizedPattern.includes("*")) {
    return normalizedPath === normalizedPattern;
  }

  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -3);
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  }

  let expression = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  expression = expression
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/__DOUBLE_STAR__/g, ".*");

  return new RegExp(`^${expression}$`).test(normalizedPath);
}

function validateChangedFiles(context: PiPromptContext, changedFiles: string[]): string[] {
  const docs = new Set(affectedDocPaths(context));
  const outputs = outputPatterns(context);

  return changedFiles.filter((path) => {
    if (docs.has(path)) return false;
    return !outputs.some((pattern) => globMatches(path, pattern));
  });
}

function createShellExecutor(workspaceRoot: string): NonNullable<EvaluationInput["executor"]> {
  return async (command): Promise<CommandExecutionResult> => {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: workspaceRoot,
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 10
      });
      return {
        status: "passed",
        evidence: [`Command passed: ${command}`],
        stdout,
        stderr,
        exitCode: 0
      };
    } catch (error) {
      const result = error as Error & {
        code?: number;
        stdout?: string;
        stderr?: string;
      };
      return {
        status: "failed",
        evidence: [`Command failed: ${command}`],
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: typeof result.code === "number" ? result.code : 1
      };
    }
  };
}

function retryPrompt(basePrompt: string, attempt: number, evidence: string[]): string {
  return [
    basePrompt,
    "",
    `Previous evaluation failed after attempt ${attempt}.`,
    "Use the evidence below to fix the same workspace without undoing valid changes.",
    "",
    "Evaluation evidence:",
    ...evidence.map((line) => `- ${line}`)
  ].join("\n");
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
  const executableSourceDoc =
    sourceDoc && (sourceDoc.loop.type === "code" || sourceDoc.outputs.length > 0 || sourceDoc.commands.length > 0)
      ? [sourceDoc]
      : [];
  const executableDocsByPath = new Map(
    [...executableSourceDoc, ...plan.affectedDocs].map((doc) => [doc.path, doc])
  );
  const executableDocs = [...executableDocsByPath.values()];
  const affectedDocs = executableDocs.map((doc) => ({
    path: doc.path,
    title: doc.title,
    evals: doc.evals,
    outputs: doc.outputs,
    commands: doc.commands
  }));
  const evalCriteria = [
    ...(sourceDoc ? formatEvalCriteria(sourceDoc.evals, sourceDoc.path) : []),
    ...plan.affectedDocs.flatMap((doc) => formatEvalCriteria(doc.evals, doc.path))
  ];
  const evalCommands = [
    ...executableDocs.flatMap((doc) => formatEvalCommands(doc.commands, doc.path))
  ];

  return {
    workspaceRoot: input.workspaceRoot,
    sourcePath: input.sourcePath,
    sourceDoc: sourceDoc
      ? {
          path: sourceDoc.path,
          title: sourceDoc.title,
          body: sourceDoc.body,
          evals: sourceDoc.evals
        }
      : undefined,
    affectedDocs,
    currentDiffSummary: summarizeDiffs(sourceDiffs),
    evalCriteria,
    evalCommands
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
            const outputs =
              doc.outputs.length > 0
                ? doc.outputs.map((output) => `    - ${output}`).join("\n")
                : "    - No code outputs declared.";
            const commands =
              doc.commands.length > 0
                ? doc.commands.map((command) => `    - ${command}`).join("\n")
                : "    - No deterministic commands declared.";
            return [
              `- ${doc.path} (${doc.title})`,
              "  Criteria:",
              criteria,
              "  Allowed outputs:",
              outputs,
              "  Commands:",
              commands
            ].join("\n");
          })
          .join("\n")
      : "- No affected downstream docs were found. Do not edit unrelated docs.";

  const evalCriteria =
    context.evalCriteria.length > 0
      ? context.evalCriteria.map((criterion) => `- ${criterion}`).join("\n")
      : "- No explicit eval criteria were found. Preserve existing loop intent and Markdown structure.";
  const sourceDoc = context.sourceDoc
    ? [
        `Path: ${context.sourceDoc.path}`,
        `Title: ${context.sourceDoc.title}`,
        "",
        context.sourceDoc.body.trim() || "(empty)"
      ].join("\n")
    : "(source document was not found)";

  return [
    "You are Pi, the only agent runtime for Sloop.",
    "",
    `Workspace root: ${context.workspaceRoot}`,
    `Source doc path: ${context.sourcePath}`,
    "",
    "Source document:",
    sourceDoc,
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
    "- For code controller docs, you may also edit only the allowed output paths listed for that doc.",
    "- Do not edit unrelated files, package files, tests, or docs outside the affected downstream set and allowed outputs.",
    "- Keep Markdown/frontmatter structure intact.",
    "- Make the smallest changes needed for the downstream docs and code outputs to reflect the source diff and pass evaluation."
  ].join("\n");
}

async function trackedRunFiles(
  workspaceRoot: string,
  context: PiPromptContext,
  extraPaths: string[] = []
): Promise<string[]> {
  return unique([
    ...affectedDocPaths(context),
    ...extraPaths,
    ...(await gitChangedCodeFiles(workspaceRoot)),
    ...(await existingOutputFiles(workspaceRoot, outputPatterns(context)))
  ]);
}

async function evaluateAttempt(
  context: PiPromptContext,
  changedFiles: string[],
  options: PiRuntimeOptions
) {
  const disallowedFiles = validateChangedFiles(context, changedFiles);
  if (disallowedFiles.length > 0) {
    return {
      status: "failed" as const,
      evidence: [`Pi changed files outside affected docs or allowed outputs: ${disallowedFiles.join(", ")}`]
    };
  }

  if (context.evalCommands.length > 0) {
    return runStructuredEvaluation({
      runtime: "pi",
      changedFiles: changedFiles.length > 0 ? changedFiles : [context.sourcePath],
      commands: context.evalCommands,
      executor: options.executor ?? createShellExecutor(context.workspaceRoot)
    });
  }

  if (changedFiles.length === 0) {
    return {
      status: "passed" as const,
      evidence: ["Pi completed successfully and reported no file changes were needed."]
    };
  }

  return runEvaluation({ runtime: "pi", changedFiles });
}

export function createPiAgentAdapter(options: PiRuntimeOptions = {}): AgentAdapter {
  return {
    runtime: "pi",
    async run(input: AgentRunInput): Promise<LoopRun> {
      const runId = input.runId ?? `pi-${Date.now()}`;
      const materializedPaths = new Set<string>();
      const defaultCascade = await materializeDefaultCascadeForSource(input.workspaceRoot, input.sourcePath);
      for (const path of defaultCascade.createdPaths) materializedPaths.add(path);
      const initialMaterialized = await materializeCodeStageControllers(input.workspaceRoot);
      for (const path of initialMaterialized.createdPaths) materializedPaths.add(path);

      let context = await buildPiPromptContext(input);
      const basePrompt = input.prompt ?? createPiPrompt(context);
      let prompt = basePrompt;
      const beforeFiles = await trackedRunFiles(input.workspaceRoot, context, [...materializedPaths]);
      const before = await snapshotFiles(input.workspaceRoot, beforeFiles);
      const attempts = configuredMaxAttempts(options);
      let changedFiles: string[] = [...materializedPaths].sort();
      let evalResult: EvalResult = {
        status: "failed" as const,
        evidence: ["Pi did not run."]
      };
      let lastResult: PiProcessResult = {
        exitCode: null,
        stdout: "",
        stderr: "",
        error: "Pi did not run."
      };

      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const result = await runPiCommand(input, runId, prompt, options);
        lastResult = result;

        if (result.exitCode !== 0) {
          evalResult = {
            status: "failed" as const,
            evidence: [
              result.error
                ? `Pi runtime failed to start: ${result.error}`
                : `Pi runtime exited with code ${result.exitCode ?? "unknown"}.`
            ]
          };
          break;
        }

        const materialized = await materializeCodeStageControllers(input.workspaceRoot);
        for (const path of materialized.createdPaths) materializedPaths.add(path);
        context = await buildPiPromptContext(input);
        const afterFiles = await trackedRunFiles(input.workspaceRoot, context, [...beforeFiles, ...materializedPaths]);
        const after = await snapshotFiles(input.workspaceRoot, afterFiles);
        changedFiles = unique([
          ...materializedPaths,
          ...afterFiles.filter((path) => before.get(path) !== after.get(path))
        ]);
        evalResult = await evaluateAttempt(context, changedFiles, options);

        if (evalResult.status === "passed") {
          break;
        }

        if (attempt < attempts) {
          prompt = retryPrompt(createPiPrompt(context), attempt, evalResult.evidence);
        } else {
          evalResult = {
            ...evalResult,
            evidence: [
              ...evalResult.evidence,
              `Stopped after ${attempts} Pi ${attempts === 1 ? "attempt" : "attempts"}.`
            ]
          };
        }
      }

      const run: PiLoopRun = {
        id: runId,
        runtime: "pi",
        sourcePath: input.sourcePath,
        status: evalResult.status,
        changedFiles,
        eval: evalResult,
        logs: {
          stdout: lastResult.stdout,
          stderr: lastResult.stderr
        }
      };

      return run;
    }
  };
}
