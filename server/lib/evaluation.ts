import matter from "gray-matter";
import type { AgentRuntime, EvalResult } from "../../src/shared/types.js";

type EvaluationStatus = "passed" | "failed" | "skipped";

export interface EvaluationCriterionInput {
  id?: string;
  text: string;
}

export interface EvaluationCommandInput {
  id?: string;
  command: string;
}

export interface CommandExecutionResult {
  status: "passed" | "failed";
  evidence?: string[];
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

export interface EvaluationCriterionEvidence {
  id: string;
  text: string;
  status: Exclude<EvaluationStatus, "skipped">;
  evidence: string[];
}

export interface EvaluationCommandEvidence {
  id: string;
  command: string;
  status: EvaluationStatus;
  evidence: string[];
}

export interface StructuredEvalResult extends EvalResult {
  criteria: EvaluationCriterionEvidence[];
  commands: EvaluationCommandEvidence[];
}

export interface EvaluationInput {
  runtime: AgentRuntime;
  changedFiles: string[];
  evidence?: string[];
  criteria?: Array<string | EvaluationCriterionInput>;
  commands?: Array<string | EvaluationCommandInput>;
  spec?: string | Record<string, unknown>;
  executor?: (
    command: string,
    context: EvaluationCommandInput
  ) => CommandExecutionResult | Promise<CommandExecutionResult>;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCriteria(value: unknown, fallback: Array<string | EvaluationCriterionInput> = []) {
  const entries = asList(value).length > 0 ? asList(value) : fallback;

  return entries.flatMap((entry, index): EvaluationCriterionInput[] => {
    if (typeof entry === "string") {
      const text = entry.trim();
      return text ? [{ id: `criterion-${index + 1}`, text }] : [];
    }

    const record = asRecord(entry);
    const text = asString(record.text);
    if (!text) return [];

    return [
      {
        id: asString(record.id) || `criterion-${index + 1}`,
        text
      }
    ];
  });
}

function normalizeCommands(value: unknown, fallback: Array<string | EvaluationCommandInput> = []) {
  const entries = asList(value).length > 0 ? asList(value) : fallback;

  return entries.flatMap((entry, index): EvaluationCommandInput[] => {
    if (typeof entry === "string") {
      const command = entry.trim();
      return command ? [{ id: `command-${index + 1}`, command }] : [];
    }

    const record = asRecord(entry);
    const command = asString(record.command);
    if (!command) return [];

    return [
      {
        id: asString(record.id) || `command-${index + 1}`,
        command
      }
    ];
  });
}

function parseSpec(spec: EvaluationInput["spec"]): {
  criteria: EvaluationCriterionInput[];
  commands: EvaluationCommandInput[];
} {
  if (!spec) return { criteria: [], commands: [] };

  const data = typeof spec === "string" ? (matter(spec).data as Record<string, unknown>) : spec;
  const record = asRecord(data);
  const evalRecord = asRecord(record.eval);
  const criteriaValue = record.criteria ?? record.evals ?? evalRecord.criteria ?? evalRecord.evals;
  const commandsValue = record.commands ?? evalRecord.commands;

  return {
    criteria: normalizeCriteria(criteriaValue),
    commands: normalizeCommands(commandsValue)
  };
}

function structuredInputs(input: EvaluationInput): {
  criteria: EvaluationCriterionInput[];
  commands: EvaluationCommandInput[];
} {
  const parsedSpec = parseSpec(input.spec);

  return {
    criteria: [
      ...parsedSpec.criteria,
      ...normalizeCriteria(input.criteria, input.criteria ?? [])
    ],
    commands: [
      ...parsedSpec.commands,
      ...normalizeCommands(input.commands, input.commands ?? [])
    ]
  };
}

function normalizeText(input: string): string {
  return input.toLowerCase().replace(/\s+/g, " ").trim();
}

function evaluateCriterion(
  criterion: EvaluationCriterionInput,
  evidence: string[]
): EvaluationCriterionEvidence {
  const id = criterion.id || "criterion";
  const normalizedCriterion = normalizeText(criterion.text);
  const matchingEvidence = evidence.filter((entry) =>
    normalizeText(entry).includes(normalizedCriterion)
  );

  if (matchingEvidence.length > 0) {
    return {
      id,
      text: criterion.text,
      status: "passed",
      evidence: matchingEvidence
    };
  }

  return {
    id,
    text: criterion.text,
    status: "failed",
    evidence: [`No evidence matched criterion: ${criterion.text}`]
  };
}

function skippedCommand(command: EvaluationCommandInput): EvaluationCommandEvidence {
  return {
    id: command.id || "command",
    command: command.command,
    status: "skipped",
    evidence: ["Command was not executed because no explicit executor callback was provided."]
  };
}

function evidenceFromCommandResult(result: CommandExecutionResult): string[] {
  const evidence = [...(result.evidence ?? [])];
  if (typeof result.exitCode === "number") evidence.push(`Exit code: ${result.exitCode}`);
  if (result.stdout?.trim()) evidence.push(`stdout: ${result.stdout.trim()}`);
  if (result.stderr?.trim()) evidence.push(`stderr: ${result.stderr.trim()}`);
  return evidence.length > 0 ? evidence : [`Command ${result.status}.`];
}

async function evaluateCommand(
  command: EvaluationCommandInput,
  executor: NonNullable<EvaluationInput["executor"]>
): Promise<EvaluationCommandEvidence> {
  const result = await executor(command.command, command);
  return {
    id: command.id || "command",
    command: command.command,
    status: result.status,
    evidence: evidenceFromCommandResult(result)
  };
}

function isPromise(value: unknown): value is Promise<unknown> {
  return Boolean(value && typeof value === "object" && "then" in value);
}

function evaluateCommandSync(
  command: EvaluationCommandInput,
  executor: NonNullable<EvaluationInput["executor"]>
): EvaluationCommandEvidence {
  const result = executor(command.command, command);
  if (isPromise(result)) {
    throw new Error("Use runStructuredEvaluation when providing an async command executor.");
  }

  return {
    id: command.id || "command",
    command: command.command,
    status: result.status,
    evidence: evidenceFromCommandResult(result)
  };
}

function defaultEvaluation(input: EvaluationInput, changedFiles: string[]): EvalResult {
  if (input.evidence && input.evidence.length > 0) {
    return {
      status: "passed",
      evidence: input.evidence
    };
  }

  if (input.runtime === "pi") {
    const label = `Pi evaluation accepted ${changedFiles.length} ${pluralize(
      changedFiles.length,
      "changed file"
    )}`;
    return {
      status: "passed",
      evidence: [`${label}: ${changedFiles.join(", ")}`]
    };
  }

  return {
    status: "passed",
    evidence: [
      `Evaluation saw ${changedFiles.length} changed ${pluralize(changedFiles.length, "file")}.`
    ]
  };
}

export async function runStructuredEvaluation(
  input: EvaluationInput
): Promise<StructuredEvalResult> {
  const changedFiles = input.changedFiles.map((file) => file.trim()).filter(Boolean);

  if (changedFiles.length === 0) {
    return {
      status: "failed",
      evidence: ["Evaluation failed because no changed files were provided."],
      criteria: [],
      commands: []
    };
  }

  const { criteria, commands } = structuredInputs(input);
  const hasStructuredInput = criteria.length > 0 || commands.length > 0;

  if (!hasStructuredInput) {
    const result = defaultEvaluation(input, changedFiles);
    return {
      ...result,
      criteria: [],
      commands: []
    };
  }

  const inputEvidence = input.evidence ?? [];
  const criterionEvidence = criteria.map((criterion) => evaluateCriterion(criterion, inputEvidence));
  const commandEvidence = input.executor
    ? await Promise.all(commands.map((command) => evaluateCommand(command, input.executor!)))
    : commands.map(skippedCommand);
  const failed =
    criterionEvidence.some((criterion) => criterion.status === "failed") ||
    commandEvidence.some((command) => command.status === "failed");
  const evidence = [
    ...criterionEvidence.flatMap((criterion) => criterion.evidence),
    ...commandEvidence.flatMap((command) => command.evidence)
  ];

  return {
    status: failed ? "failed" : "passed",
    evidence,
    criteria: criterionEvidence,
    commands: commandEvidence
  };
}

export function runEvaluation(input: EvaluationInput): EvalResult | StructuredEvalResult {
  const changedFiles = input.changedFiles.map((file) => file.trim()).filter(Boolean);

  if (changedFiles.length === 0) {
    return {
      status: "failed",
      evidence: ["Evaluation failed because no changed files were provided."]
    };
  }

  const { criteria, commands } = structuredInputs(input);
  const hasStructuredInput = criteria.length > 0 || commands.length > 0;

  if (!hasStructuredInput) {
    return defaultEvaluation(input, changedFiles);
  }

  const inputEvidence = input.evidence ?? [];
  const criterionEvidence = criteria.map((criterion) => evaluateCriterion(criterion, inputEvidence));
  const commandEvidence = input.executor
    ? commands.map((command) => evaluateCommandSync(command, input.executor!))
    : commands.map(skippedCommand);
  const failed =
    criterionEvidence.some((criterion) => criterion.status === "failed") ||
    commandEvidence.some((command) => command.status === "failed");

  return {
    status: failed ? "failed" : "passed",
    evidence: [
      ...criterionEvidence.flatMap((criterion) => criterion.evidence),
      ...commandEvidence.flatMap((command) => command.evidence)
    ],
    criteria: criterionEvidence,
    commands: commandEvidence
  };
}
