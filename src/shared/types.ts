export type LoopKind = 'architect' | 'inner' | 'leaf';
export type LoopStatus =
  | 'planned' | 'awaiting_approval' | 'queued'
  | 'executing' | 'blocked' | 'review' | 'done' | 'failed';
export type Delta = 'add' | 'change' | 'delete';

export interface AcceptanceCriterion {
  id: string;
  text: string;
  verify?: string;     // shell command; exit 0 = passed
  locked?: boolean;    // authored by the parent; the executing leaf must not weaken it
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
  stages: { name: string; role: string; model: string; gate?: boolean }[];
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

// ---- Global assistant (streaming, multi-turn, agentic) ----

/** A configured model alias surfaced to the picker. Never carries an API key. */
export interface ModelOption {
  alias: string;          // registry key, e.g. 'opus'
  provider: ProviderName;
  id: string;             // concrete provider model id
}

/** One write the assistant performed in a turn — informational, drives UI chips. */
export interface ToolActivity {
  tool: string;          // e.g. 'edit_doc', 'create_adr'
  path?: string;         // workspace-relative path written, when applicable
  ok: boolean;
}

/** A message in the client-held conversation thread. Sent back in full each turn. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  tools?: ToolActivity[]; // assistant turns only; informational
}

/** POST /api/assistant/stream request body. */
export interface AssistantChatRequest {
  messages: ChatMessage[]; // full thread, oldest first; last entry is the new user turn
  model?: string;          // registry alias from the picker
}

/** Server → client SSE events (one JSON object per `data:` line). */
export type AssistantStreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_start'; tool: string; path?: string }
  | { type: 'tool_result'; tool: string; path?: string; ok: boolean }
  | { type: 'done' }
  | { type: 'error'; message: string };
