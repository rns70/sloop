// Global assistant — server side. One pi-ai call returning a delimited envelope, parsed
// into a typed proposal (answer/edit/create-*). The logic behind `POST /api/assistant`.
export {
  createAssistantService, toPiModel,
  type AssistantService, type AssistantDeps, type AssistantFiles, type AssistantModelCall,
} from './assistantService';
export { buildAssistantPrompt, pickAssistantAlias, type AssistantDoc, type AssistantPromptParts } from './prompt';
export { parseEnvelope } from './envelope';
export { toModelOptions } from './models';
