import type {
  AdrDoc, LoopDoc, WorkflowDef, RoleDef, DatabankDiff, CascadeSummary, LoopStatus,
  ModelRegistry, ResolvedModel,
} from './types';

export interface FilesService {
  listAdrs(): Promise<AdrDoc[]>;
  readAdr(relPath: string): Promise<AdrDoc>;
  writeAdr(doc: AdrDoc): Promise<void>;
  /** Move/rename an ADR file, or a whole folder prefix, on the working tree.
   *  `from`/`to` are loops-prefixed paths. Throws MoveError on collision,
   *  cycle, traversal, or a missing source. */
  moveAdr(from: string, to: string): Promise<void>;
  /** Delete an ADR file, or a whole folder subtree, on the working tree.
   *  `relPath` is a loops-prefixed path. Throws DeleteError on traversal,
   *  an attempt to delete the loops/ root, or a missing target. */
  deleteAdr(relPath: string): Promise<void>;
  readLoop(relPath: string): Promise<LoopDoc>;
  writeLoop(loop: LoopDoc): Promise<void>;
  listLoops(cascadeId: string): Promise<LoopDoc[]>;
  listCascadeIds(): Promise<string[]>;           // subdirectory names under cascades/
  listWorkflows(): Promise<WorkflowDef[]>;
  listRoles(): Promise<RoleDef[]>;
  readModelRegistry(): Promise<ModelRegistry>;   // from .sloop/config.md frontmatter
}

/** Pure helper (no I/O): alias + registry + env -> concrete provider/id/key. Lives in src/shared. */
export type ResolveModel = (alias: string, registry: ModelRegistry, env: NodeJS.ProcessEnv) => ResolvedModel;

export interface GitService {
  diffDatabank(): Promise<DatabankDiff>;     // loops working tree vs last commit
  commitAll(message: string): Promise<string>; // returns short sha
}

export interface Executor {
  // Spawns the coding agent for a leaf, streams output, runs verify commands.
  run(loop: LoopDoc, onOutput: (chunk: string) => void): Promise<{ ok: boolean }>;
}

export interface CascadeEngine {
  kickoff(workflowId: string): Promise<CascadeSummary>;  // diff → architect proposes tree (awaiting_approval)
  get(cascadeId: string): Promise<{ summary: CascadeSummary; loops: LoopDoc[] }>;
  approve(cascadeId: string): Promise<void>;             // run approved leaves
  recomputeStatus(cascadeId: string): Promise<LoopStatus>; // bubble up the invariant
}
