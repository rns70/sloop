// Global assistant — server side. A streaming, multi-turn agent loop over pi-ai native
// tools; auto-applies writes. Behind `POST /api/assistant/stream`.
export { runAssistantAgent, type AgentDeps, type StreamFn } from './agent';
export { ASSISTANT_TOOLS, createToolExecutor, type AssistantWorkspace, type ToolExecutor, type ToolRunResult } from './tools';
export { buildAssistantSystemPrompt, pickAssistantAlias } from './prompt';
export { toPiModel } from './piModel';
export { toModelOptions } from './models';
