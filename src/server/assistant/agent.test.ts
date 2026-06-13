import { describe, it, expect, vi } from 'vitest';
import type { AssistantMessage, AssistantMessageEvent, ToolCall } from '@earendil-works/pi-ai';
import type { AssistantStreamEvent } from '../../shared/index';
import { runAssistantAgent, type AgentDeps } from './agent';
import type { ToolExecutor } from './tools';

/** Build a fake AssistantMessageEventStream-like async iterable from scripted events. */
function fakeStream(events: AssistantMessageEvent[]) {
  return { async *[Symbol.asyncIterator]() { for (const e of events) yield e; } };
}
function asstMsg(content: AssistantMessage['content'], stopReason: AssistantMessage['stopReason']): AssistantMessage {
  return { role: 'assistant', content, api: 'anthropic-messages', provider: 'anthropic', model: 'm',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason, timestamp: 0 };
}

const registry = {
  models: { sonnet: { provider: 'anthropic', id: 'claude-x' } },
  providers: { anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' } },
} as any;

const baseDeps = (streamFn: AgentDeps['stream'], exec: ToolExecutor): AgentDeps => ({
  stream: streamFn, toolExecutor: exec,
  env: { ANTHROPIC_API_KEY: 'k' } as NodeJS.ProcessEnv,
  readModelRegistry: async () => registry,
});

describe('runAssistantAgent', () => {
  it('streams text deltas then completes on stop', async () => {
    const text = asstMsg([{ type: 'text', text: 'Hello' }], 'stop');
    const streamFn = vi.fn(() => fakeStream([
      { type: 'text_delta', contentIndex: 0, delta: 'Hel', partial: text },
      { type: 'text_delta', contentIndex: 0, delta: 'lo', partial: text },
      { type: 'done', reason: 'stop', message: text },
    ]) as any);
    const exec: ToolExecutor = { run: vi.fn() };
    const out: AssistantStreamEvent[] = [];
    await runAssistantAgent({ messages: [{ role: 'user', text: 'hi' }] }, baseDeps(streamFn, exec), (e) => out.push(e));
    expect(out).toContainEqual({ type: 'text_delta', delta: 'Hel' });
    expect(out.at(-1)).toEqual({ type: 'done' });
    expect(exec.run).not.toHaveBeenCalled();
    expect(streamFn).toHaveBeenCalledTimes(1);
  });

  it('maps a prior assistant turn to ARRAY content (multi-turn flatMap regression)', async () => {
    // pi-ai's transformMessages does `assistantMsg.content.flatMap(...)`; a bare
    // string content threw on any 2nd+ turn. Assert the assistant history entry
    // handed to the stream has array content with the right shape.
    const text = asstMsg([{ type: 'text', text: 'ok' }], 'stop');
    const streamFn = vi.fn(() => fakeStream([
      { type: 'text_delta', contentIndex: 0, delta: 'ok', partial: text },
      { type: 'done', reason: 'stop', message: text },
    ]) as any);
    const exec: ToolExecutor = { run: vi.fn() };
    await runAssistantAgent(
      { messages: [
        { role: 'user', text: 'hi' },
        { role: 'assistant', text: 'Hello!' },
        { role: 'user', text: 'again' },
      ] },
      baseDeps(streamFn, exec),
      () => {},
    );
    const context = (streamFn.mock.calls[0] as any[])[1] as { messages: any[] };
    const prior = context.messages.find((m) => m.role === 'assistant');
    expect(Array.isArray(prior.content)).toBe(true);
    expect(prior.content).toEqual([{ type: 'text', text: 'Hello!' }]);
    expect(typeof prior.content.flatMap).toBe('function'); // the exact thing pi-ai calls
  });

  it('executes a tool call then loops and finishes', async () => {
    const toolCall: ToolCall = { type: 'toolCall', id: 't1', name: 'edit_doc', arguments: { path: 'databank/auth.md', content: 'x' } };
    const turn1 = asstMsg([toolCall], 'toolUse');
    const turn2 = asstMsg([{ type: 'text', text: 'done' }], 'stop');
    const streamFn = vi.fn()
      .mockReturnValueOnce(fakeStream([{ type: 'toolcall_end', contentIndex: 0, toolCall, partial: turn1 }, { type: 'done', reason: 'toolUse', message: turn1 }]) as any)
      .mockReturnValueOnce(fakeStream([{ type: 'text_delta', contentIndex: 0, delta: 'done', partial: turn2 }, { type: 'done', reason: 'stop', message: turn2 }]) as any);
    const exec: ToolExecutor = { run: vi.fn(async () => ({ ok: true, text: 'Edited databank/auth.md.', path: 'databank/auth.md' })) };
    const out: AssistantStreamEvent[] = [];
    await runAssistantAgent({ messages: [{ role: 'user', text: 'edit it' }] }, baseDeps(streamFn, exec), (e) => out.push(e));
    expect(exec.run).toHaveBeenCalledTimes(1);
    expect(out).toContainEqual({ type: 'tool_start', tool: 'edit_doc', path: 'databank/auth.md' });
    expect(out).toContainEqual({ type: 'tool_result', tool: 'edit_doc', path: 'databank/auth.md', ok: true });
    expect(streamFn).toHaveBeenCalledTimes(2);
    expect(out.at(-1)).toEqual({ type: 'done' });
  });

  it('stops at the max-iteration cap and emits done', async () => {
    const toolCall: ToolCall = { type: 'toolCall', id: 't', name: 'list_docs', arguments: {} };
    const loopTurn = asstMsg([toolCall], 'toolUse');
    const streamFn = vi.fn(() => fakeStream([{ type: 'toolcall_end', contentIndex: 0, toolCall, partial: loopTurn }, { type: 'done', reason: 'toolUse', message: loopTurn }]) as any);
    const exec: ToolExecutor = { run: vi.fn(async () => ({ ok: true, text: 'ok' })) };
    const out: AssistantStreamEvent[] = [];
    await runAssistantAgent({ messages: [{ role: 'user', text: 'go' }] }, { ...baseDeps(streamFn, exec), maxIterations: 3 }, (e) => out.push(e));
    expect(streamFn).toHaveBeenCalledTimes(3);
    expect(out.at(-1)).toEqual({ type: 'done' });
  });

  it('stream error event → emits error and does not call exec', async () => {
    const errorMsg = { ...asstMsg([], 'stop'), errorMessage: 'boom' };
    const streamFn = vi.fn(() => fakeStream([
      { type: 'error', error: errorMsg } as any,
    ]) as any);
    const exec: ToolExecutor = { run: vi.fn() };
    const out: AssistantStreamEvent[] = [];
    await runAssistantAgent({ messages: [{ role: 'user', text: 'hi' }] }, baseDeps(streamFn, exec), (e) => out.push(e));
    expect(out).toContainEqual(expect.objectContaining({ type: 'error' }));
    expect(exec.run).not.toHaveBeenCalled();
  });

  it('abort mid-stream → emits done', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const throwingStream = {
      async *[Symbol.asyncIterator]() { throw abortErr; },
    };
    const streamFn = vi.fn(() => throwingStream as any);
    const exec: ToolExecutor = { run: vi.fn() };
    const out: AssistantStreamEvent[] = [];
    const signal = AbortSignal.abort();
    await runAssistantAgent({ messages: [{ role: 'user', text: 'hi' }] }, baseDeps(streamFn, exec), (e) => out.push(e), signal);
    expect(out.at(-1)).toEqual({ type: 'done' });
  });

  it('stream ends with no done event → emits error', async () => {
    const partial = asstMsg([{ type: 'text', text: 'He' }], 'stop');
    const streamFn = vi.fn(() => fakeStream([
      { type: 'text_delta', contentIndex: 0, delta: 'He', partial } as any,
      // no 'done' event — stream ends here
    ]) as any);
    const exec: ToolExecutor = { run: vi.fn() };
    const out: AssistantStreamEvent[] = [];
    await runAssistantAgent({ messages: [{ role: 'user', text: 'hi' }] }, baseDeps(streamFn, exec), (e) => out.push(e));
    expect(out).toContainEqual(expect.objectContaining({ type: 'error' }));
  });

  it('tool executor throws → emits tool_start then error, no second stream call', async () => {
    const toolCall: ToolCall = { type: 'toolCall', id: 't1', name: 'edit_doc', arguments: { path: 'a.md' } };
    const turn1 = asstMsg([toolCall], 'toolUse');
    const streamFn = vi.fn(() => fakeStream([
      { type: 'toolcall_end', contentIndex: 0, toolCall, partial: turn1 },
      { type: 'done', reason: 'toolUse', message: turn1 },
    ]) as any);
    const exec: ToolExecutor = { run: vi.fn(async () => { throw new Error('tool boom'); }) };
    const out: AssistantStreamEvent[] = [];
    await runAssistantAgent({ messages: [{ role: 'user', text: 'go' }] }, baseDeps(streamFn, exec), (e) => out.push(e));
    expect(out).toContainEqual(expect.objectContaining({ type: 'tool_start' }));
    expect(out).toContainEqual(expect.objectContaining({ type: 'error' }));
    expect(streamFn).toHaveBeenCalledTimes(1);
  });

  it('tool returns ok:false → emits tool_result with ok:false and still ends with done', async () => {
    const toolCall: ToolCall = { type: 'toolCall', id: 't1', name: 'edit_doc', arguments: { path: 'a.md' } };
    const turn1 = asstMsg([toolCall], 'toolUse');
    const turn2 = asstMsg([{ type: 'text', text: 'sorry' }], 'stop');
    const streamFn = vi.fn()
      .mockReturnValueOnce(fakeStream([
        { type: 'toolcall_end', contentIndex: 0, toolCall, partial: turn1 },
        { type: 'done', reason: 'toolUse', message: turn1 },
      ]) as any)
      .mockReturnValueOnce(fakeStream([
        { type: 'text_delta', contentIndex: 0, delta: 'sorry', partial: turn2 },
        { type: 'done', reason: 'stop', message: turn2 },
      ]) as any);
    const exec: ToolExecutor = { run: vi.fn(async () => ({ ok: false, text: 'nope' })) };
    const out: AssistantStreamEvent[] = [];
    await runAssistantAgent({ messages: [{ role: 'user', text: 'go' }] }, baseDeps(streamFn, exec), (e) => out.push(e));
    expect(out).toContainEqual(expect.objectContaining({ type: 'tool_result', ok: false }));
    expect(out.at(-1)).toEqual({ type: 'done' });
    expect(streamFn).toHaveBeenCalledTimes(2);
  });
});
