export type DocStatus =
  | "idle"
  | "running"
  | "paused"
  | "evaluating"
  | "passing"
  | "passed"
  | "failed"
  | "archived";

export type AgentRuntime = "pi";
export type LoopStageKind = "doc" | "code";

export interface LoopStage {
  id: string;
  kind: LoopStageKind;
  title: string;
  doc: string;
  status: DocStatus;
  agent?: AgentRuntime;
  outputs: string[];
  evals: EvalCriteria[];
  commands: string[];
}

export interface EvalCriteria {
  id: string;
  text: string;
  status?: "pending" | "passed" | "failed";
}

export interface LoopMetadata {
  id: string;
  type: string;
  status: DocStatus;
  autoApply: boolean;
  stages: LoopStage[];
}

export interface LoopDoc {
  path: string;
  title: string;
  frontmatter: Record<string, unknown>;
  loop: LoopMetadata;
  stages: LoopStage[];
  evals: EvalCriteria[];
  outputs: string[];
  commands: string[];
  body: string;
  raw: string;
}

export interface DiffLine {
  type: "context" | "add" | "remove";
  text: string;
}

export interface FileDiff {
  path: string;
  lines: DiffLine[];
}

export interface EvalResult {
  status: "passed" | "failed";
  evidence: string[];
}

export interface LoopRun {
  id: string;
  runtime: AgentRuntime;
  sourcePath: string;
  status: DocStatus;
  changedFiles: string[];
  eval: EvalResult;
  log?: string[];
}

export interface StoredLoopRun extends LoopRun {
  createdAt: string;
  updatedAt: string;
  log: string[];
}

export interface CascadeRun extends LoopRun {
  kind: "cascade";
  createdAt: string;
}

export interface HistoryEntry {
  id: string;
  kind: "cascade" | "agent" | "eval" | "pause" | "resume" | "archive";
  title: string;
  createdAt: string;
  sourcePath?: string;
  changedFiles: string[];
  status: DocStatus;
  summary: string;
}

export interface WorkspaceSummary {
  root: string;
  files: string[];
  docs: LoopDoc[];
  git: GitStatus;
  history: HistoryEntry[];
}

export interface GitStatus {
  branch: string;
  dirty: boolean;
  files: string[];
}

export interface AgentAdapter {
  runtime: AgentRuntime;
  run(input: AgentRunInput): Promise<LoopRun>;
}

export interface AgentRunInput {
  workspaceRoot: string;
  sourcePath: string;
  runId?: string;
  prompt?: string;
}
