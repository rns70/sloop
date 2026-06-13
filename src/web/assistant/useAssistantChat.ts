import { useCallback, useEffect, useRef, useState } from 'react';
import { streamAssistant } from '../api-client/index';
import type { ChatMessage, ToolActivity, AssistantStreamEvent } from '../../shared/index';

export interface UseAssistantChat {
  messages: ChatMessage[];
  streaming: boolean;
  error: string | null;
  send: (text: string) => Promise<void>;
  stop: () => void;
}

/**
 * Pure event reducer — exported so tests can verify the message-mutation logic
 * without a DOM or React environment.
 *
 * Returns the (possibly new) assistant message plus an optional `wrotePath`
 * when a successful tool_result with a path was processed.
 */
export function applyEvent(
  msg: ChatMessage,
  e: AssistantStreamEvent,
): { msg: ChatMessage; wrotePath?: string } {
  switch (e.type) {
    case 'text_delta':
      return { msg: { ...msg, text: msg.text + e.delta } };

    case 'tool_result': {
      const activity: ToolActivity = { tool: e.tool, path: e.path, ok: e.ok };
      return {
        msg: { ...msg, tools: [...(msg.tools ?? []), activity] },
        wrotePath: e.ok && e.path ? e.path : undefined,
      };
    }

    // 'done', 'error', 'tool_start': no change to the message object itself.
    // 'error' surfaces via the hook's setError path; 'done'/'tool_start' are informational.
    default:
      return { msg };
  }
}

const SESSION_KEY = 'sloop.assistant.thread';

function loadThread(): ChatMessage[] {
  if (typeof sessionStorage === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as ChatMessage[]).filter(
      (m) => m.role === 'user' || (m.text && m.text.trim()) || (m.tools && m.tools.length > 0),
    );
  } catch {
    return [];
  }
}

/** Holds the conversation thread, streams agent turns, and reports written paths. */
export function useAssistantChat(opts: {
  model?: string;
  onWrote?: (paths: string[]) => void;
}): UseAssistantChat {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadThread());
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const sendingRef = useRef(false);
  const cancelledRef = useRef(false);

  // Persist thread to sessionStorage on every change (try/catch for quota/availability).
  useEffect(() => {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(messages));
      }
    } catch {
      // sessionStorage unavailable or quota exceeded — silently ignore.
    }
  }, [messages]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sendingRef.current) return;
      sendingRef.current = true;
      cancelledRef.current = false;

      setError(null);
      const history: ChatMessage[] = [...messages, { role: 'user', text: trimmed }];
      // Seed an empty assistant message we stream into.
      setMessages([...history, { role: 'assistant', text: '', tools: [] }]);
      setStreaming(true);

      const wrote: string[] = [];

      const { done, abort } = streamAssistant(
        { messages: history, model: opts.model },
        (e) => {
          if (e.type === 'error') {
            setError(e.message);
            return;
          }
          setMessages((cur) => {
            const last = cur[cur.length - 1];
            if (!last || last.role !== 'assistant') return cur;
            const { msg: next, wrotePath } = applyEvent(last, e);
            if (wrotePath) wrote.push(wrotePath);
            if (next === last) return cur; // no change — skip re-render
            return [...cur.slice(0, -1), next];
          });
        },
      );

      abortRef.current = abort;
      try {
        await done;
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        sendingRef.current = false;
        setStreaming(false);
        abortRef.current = null;
        if (!cancelledRef.current && wrote.length) opts.onWrote?.(wrote);
      }
    },
    [messages, opts.model, opts.onWrote],
  );

  const stop = useCallback(() => {
    cancelledRef.current = true;
    abortRef.current?.();
    setStreaming(false);
  }, []);

  return { messages, streaming, error, send, stop };
}
