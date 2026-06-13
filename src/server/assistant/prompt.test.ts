import { describe, it, expect } from 'vitest';
import { buildAssistantSystemPrompt, pickAssistantAlias } from './prompt';

describe('buildAssistantSystemPrompt', () => {
  it('describes the tools and the no-confirmation behavior', () => {
    const s = buildAssistantSystemPrompt();
    expect(s).toContain('create_adr');
    expect(s).toContain('apply immediately');
  });
});

describe('pickAssistantAlias', () => {
  const reg = { models: { sonnet: {}, opus: {} } };
  it('honors an explicit model', () => { expect(pickAssistantAlias('opus', {} as NodeJS.ProcessEnv, reg)).toBe('opus'); });
  it('falls back to SLOOP_ASSISTANT_MODEL', () => { expect(pickAssistantAlias(undefined, { SLOOP_ASSISTANT_MODEL: 'opus' } as NodeJS.ProcessEnv, reg)).toBe('opus'); });
  it('defaults to sonnet when present', () => { expect(pickAssistantAlias(undefined, {} as NodeJS.ProcessEnv, reg)).toBe('sonnet'); });
  it('uses the first alias when no sonnet', () => { expect(pickAssistantAlias(undefined, {} as NodeJS.ProcessEnv, { models: { foo: {} } })).toBe('foo'); });
  it('throws on an empty registry', () => { expect(() => pickAssistantAlias(undefined, {} as NodeJS.ProcessEnv, { models: {} })).toThrow(); });
});
