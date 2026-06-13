/**
 * Tests for useAssistantChat using the pure-reducer approach.
 *
 * Why no renderHook: @testing-library/react is not installed and vitest is not
 * configured with a jsdom environment. The hook's entire event-handling logic is
 * extracted into the pure `applyEvent` reducer (exported for testing); the hook
 * itself is a thin wrapper that calls it via setMessages.
 */
import { describe, it, expect } from 'vitest';
import type { AssistantStreamEvent } from '../../shared/index';
import type { ChatMessage } from '../../shared/index';
import { applyEvent } from './useAssistantChat';

function seed(): ChatMessage {
  return { role: 'assistant', text: '', tools: [] };
}

describe('applyEvent reducer', () => {
  it('appends text deltas', () => {
    const events: AssistantStreamEvent[] = [
      { type: 'text_delta', delta: 'Hi ' },
      { type: 'text_delta', delta: 'there' },
    ];
    let msg = seed();
    for (const e of events) ({ msg } = applyEvent(msg, e));
    expect(msg.text).toBe('Hi there');
  });

  it('records a successful tool_result and captures the wrote path', () => {
    const msg = seed();
    const e: AssistantStreamEvent = {
      type: 'tool_result',
      tool: 'create_adr',
      path: 'databank/x.md',
      ok: true,
    };
    const { msg: next, wrotePath } = applyEvent(msg, e);
    expect(next.tools).toContainEqual({ tool: 'create_adr', path: 'databank/x.md', ok: true });
    expect(wrotePath).toBe('databank/x.md');
  });

  it('records a failed tool_result without capturing a wrote path', () => {
    const msg = seed();
    const e: AssistantStreamEvent = {
      type: 'tool_result',
      tool: 'edit_doc',
      path: 'databank/y.md',
      ok: false,
    };
    const { msg: next, wrotePath } = applyEvent(msg, e);
    expect(next.tools).toContainEqual({ tool: 'edit_doc', path: 'databank/y.md', ok: false });
    expect(wrotePath).toBeUndefined();
  });

  it('is a no-op for unknown event types', () => {
    const msg = seed();
    // 'done' carries no payload — message should be unchanged.
    const { msg: next } = applyEvent(msg, { type: 'done' });
    expect(next).toEqual(msg);
  });

  it('is a no-op for error events (error surfaces via separate channel)', () => {
    const msg = seed();
    const { msg: next } = applyEvent(msg, { type: 'error', message: 'boom' });
    expect(next).toEqual(msg);
  });
});
