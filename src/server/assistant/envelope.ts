import type { AssistantAction, AssistantProposal } from '../../shared/index';

const ACTIONS: readonly AssistantAction[] = ['answer', 'edit', 'create-adr', 'create-role', 'create-template'];

/** Extract the first `<tag>…</tag>` value (non-greedy), trimmed; undefined if absent. */
function tag(raw: string, name: string): string | undefined {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i').exec(raw);
  return m ? m[1].trim() : undefined;
}

/**
 * Parse the model's delimited envelope into a typed proposal. Tolerant by design: a
 * missing/garbled envelope or an unrecognized action degrades to a plain `answer`
 * carrying the raw text — so a misbehaving model can never trigger a typed write.
 */
export function parseEnvelope(raw: string): AssistantProposal {
  const actionRaw = tag(raw, 'action')?.toLowerCase();
  const content = tag(raw, 'content');
  const action = ACTIONS.find((a) => a === actionRaw);
  if (!action || action === 'answer' || content === undefined) {
    // Degrade to a plain answer: prefer a parsed <content> payload when present
    // (an unknown/garbled action still carries text), else the whole raw reply.
    return { action: 'answer', summary: 'answer', content: content ?? raw.trim() };
  }
  return {
    action,
    summary: tag(raw, 'summary') ?? action,
    targetPath: tag(raw, 'path'),
    title: tag(raw, 'title'),
    content,
  };
}
