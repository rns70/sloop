import { describe, it, expect } from 'vitest';
import type { AssistantRequest } from '../../shared/index';
import { buildAssistantPrompt, pickAssistantAlias, type AssistantDoc } from './prompt';

const req: AssistantRequest = { instruction: 'make a security-reviewer role', contextPaths: ['databank/adr-007.md'] };
const docs: AssistantDoc[] = [{ relPath: 'databank/adr-007.md', content: '# Token rotation' }];

describe('buildAssistantPrompt', () => {
  it('documents the envelope format and every action in the system prompt', () => {
    const { systemPrompt } = buildAssistantPrompt(req, docs);
    for (const t of ['<action>', '<content>', 'create-adr', 'create-role', 'create-workflow', 'edit', 'answer']) {
      expect(systemPrompt).toContain(t);
    }
  });
  it('includes the instruction and the context docs in the user prompt', () => {
    const { userPrompt } = buildAssistantPrompt(req, docs);
    expect(userPrompt).toContain('make a security-reviewer role');
    expect(userPrompt).toContain('databank/adr-007.md');
    expect(userPrompt).toContain('# Token rotation');
  });
  it('clips an oversized doc body', () => {
    const big = [{ relPath: 'databank/big.md', content: 'x'.repeat(9000) }];
    expect(buildAssistantPrompt(req, big).userPrompt).toContain('truncated');
  });
});

describe('pickAssistantAlias', () => {
  const registry = { models: { opus: {}, sonnet: {} } };
  it('prefers the explicit request model', () => {
    expect(pickAssistantAlias({ ...req, model: 'opus' }, {}, registry, 'sonnet')).toBe('opus');
  });
  it('falls back to the configured default when present', () => {
    expect(pickAssistantAlias(req, {}, registry, 'sonnet')).toBe('sonnet');
  });
  it('falls back to the first alias when the default is absent', () => {
    expect(pickAssistantAlias(req, {}, { models: { haiku: {} } }, 'sonnet')).toBe('haiku');
  });
  it('honors the SLOOP_ASSISTANT_MODEL env override', () => {
    expect(pickAssistantAlias(req, { SLOOP_ASSISTANT_MODEL: 'opus' }, registry, 'sonnet')).toBe('opus');
  });
});
