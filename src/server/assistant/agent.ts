import type { Api, AssistantMessage, AssistantMessageEvent, Context, Message, Model, ToolCall } from '@earendil-works/pi-ai';
import type { AssistantChatRequest, AssistantStreamEvent, ChatMessage, ModelRegistry } from '../../shared/index';
import { resolveModel } from '../../shared/index';
import { ASSISTANT_TOOLS, type ToolExecutor } from './tools';
import { pickAssistantAlias, buildAssistantSystemPrompt } from './prompt';
import { toPiModel } from './piModel';

/** The streaming primitive, injectable for tests. Matches pi-ai's `stream` shape. */
export type StreamFn = (
  model: Model<Api>, context: Context,
  options?: { apiKey?: string; signal?: AbortSignal; maxTokens?: number },
) => AsyncIterable<AssistantMessageEvent>;

export interface AgentDeps {
  stream: StreamFn;
  toolExecutor: ToolExecutor;
  env: NodeJS.ProcessEnv;
  readModelRegistry: () => Promise<ModelRegistry>;
  maxIterations?: number;
}

const DEFAULT_MAX_ITERATIONS = 12;

/** Map the client thread to pi-ai messages (prior turns collapse to plain text). */
function toPiMessages(messages: ChatMessage[]): Message[] {
  return messages.map((m) => ({ role: m.role, content: m.text, timestamp: 0 } as Message));
}

export async function runAssistantAgent(
  req: AssistantChatRequest,
  deps: AgentDeps,
  emit: (e: AssistantStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const registry = await deps.readModelRegistry();
  const alias = pickAssistantAlias(req.model, deps.env, registry);
  const resolved = resolveModel(alias, registry, deps.env);
  const model = toPiModel(resolved);
  const system = buildAssistantSystemPrompt();
  const messages = toPiMessages(req.messages);
  const max = deps.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  for (let i = 0; i < max; i += 1) {
    if (signal?.aborted) { emit({ type: 'done' }); return; }
    const context: Context = { systemPrompt: system, messages, tools: ASSISTANT_TOOLS };
    const piStream = deps.stream(model, context, { apiKey: resolved.apiKey, signal, maxTokens: 4096 });

    let final: AssistantMessage | undefined;
    const calls: ToolCall[] = [];
    try {
      for await (const ev of piStream) {
        if (ev.type === 'text_delta') {
          emit({ type: 'text_delta', delta: ev.delta });
        } else if (ev.type === 'toolcall_end') {
          calls.push(ev.toolCall);
        } else if (ev.type === 'done') {
          final = ev.message;
        } else if (ev.type === 'error') {
          // ev.error is an AssistantMessage; errorMessage is its optional field
          emit({ type: 'error', message: ev.error.errorMessage ?? 'stream error' });
          return;
        }
      }
    } catch (e) {
      if (signal?.aborted || (e instanceof Error && e.name === 'AbortError')) {
        emit({ type: 'done' });
        return;
      }
      emit({ type: 'error', message: e instanceof Error ? e.message : 'stream error' });
      return;
    }

    if (!final) { emit({ type: 'error', message: 'stream ended without a final message' }); return; }
    if (final.stopReason !== 'toolUse' || calls.length === 0) { emit({ type: 'done' }); return; }

    // Append the assistant turn (with its tool calls), then run each tool and append results.
    messages.push(final);
    for (const call of calls) {
      // Only surfaces string `path`/`slug` args for the UI chip; falls back to `undefined` otherwise.
      const path = typeof call.arguments?.path === 'string' ? call.arguments.path
        : typeof call.arguments?.slug === 'string' ? call.arguments.slug : undefined;
      emit({ type: 'tool_start', tool: call.name, path });
      let result: Awaited<ReturnType<typeof deps.toolExecutor.run>>;
      try {
        result = await deps.toolExecutor.run(call);
      } catch (e) {
        emit({ type: 'error', message: e instanceof Error ? e.message : 'tool execution failed' });
        return;
      }
      emit({ type: 'tool_result', tool: call.name, path: result.path ?? path, ok: result.ok });
      const toolResult: Message = {
        role: 'toolResult',
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: 'text', text: result.text }],
        isError: !result.ok,
        timestamp: 0,
      };
      messages.push(toolResult);
    }
  }
  console.warn(`assistant agent: hit max iterations (${max}); ending turn.`);
  emit({ type: 'done' }); // max-iteration cap reached
}
