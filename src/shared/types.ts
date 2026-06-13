export type LoopKind = 'architect' | 'inner' | 'leaf';
export type LoopStatus =
  | 'planned' | 'awaiting_approval' | 'queued'
  | 'executing' | 'blocked' | 'review' | 'done' | 'failed';
export type Delta = 'add' | 'change' | 'delete';

export interface AcceptanceCriterion {
  id: string;
  text: string;
  verify?: string;     // shell command; exit 0 = passed
  passed: boolean;
}

export interface LoopFrontmatter {
  id: string;
  kind: LoopKind;
  role: string;
  model: string;
  status: LoopStatus;
  delta?: Delta;
  parent?: string;
  children: string[];
  sourceAdr?: string;
  template?: string;
  acceptanceCriteria: AcceptanceCriterion[];
  executor?: string;
}

export interface LoopDoc {
  frontmatter: LoopFrontmatter;
  body: string;
  relPath: string;     // path within the workspace, e.g. cascades/<id>/<loop>.md
}

export interface AdrDoc {
  id: string;
  relPath: string;
  title: string;
  body: string;
  acceptanceCriteria: AcceptanceCriterion[];
}

export interface CascadeSummary {
  id: string;
  createdAt: string;            // ISO; pass in, never call Date.now in shared code
  template: string;
  deltas: { add: number; change: number; delete: number };
  rootLoopId: string;
  status: LoopStatus;           // derived from the root loop
}

export interface TemplateDef {
  id: string;
  name: string;
  stages: { name: string; role: string; model: string }[];
  guidance: string;             // prose the architect follows
}

export interface RoleDef {
  id: string;
  name: string;
  defaultModel: string;
  brief: string;
  color?: string;               // tag color in UI
}

export interface DatabankDiff {
  changed: { relPath: string; delta: Delta; before: string; after: string }[];
}

// ---- Model providers (multi-provider: Anthropic + Nebius/Nemotron) ----
export type ProviderName = 'anthropic' | 'nebius';

export interface ModelEntry {
  provider: ProviderName;
  id: string;            // the provider's model id, e.g. 'claude-haiku-4-5-20251001'
                         // or 'nvidia/llama-3.1-nemotron-70b-instruct'
}
export interface ProviderConfig {
  baseUrl?: string;      // nebius: https://api.studio.nebius.ai/v1
  apiKeyEnv: string;     // env var holding the key
}
export interface ModelRegistry {
  models: Record<string, ModelEntry>;        // alias (e.g. 'haiku','nemotron') -> entry
  providers: Record<ProviderName, ProviderConfig>;
}

/** Resolve a loop's `model` alias to a concrete provider + id + key. */
export interface ResolvedModel {
  provider: ProviderName;
  id: string;
  baseUrl?: string;
  apiKey: string;
}

// ---- Authoring assistant (Cursor-style editing of databank docs) ----
export interface AuthorRequest {
  scope: 'selection' | 'doc' | 'multi';
  instruction: string;       // the user's ask
  docPaths: string[];        // current doc; plus extra docs when scope='multi'
  selectionText?: string;    // required when scope='selection'
  model?: string;            // registry alias; falls back to a config default
}
