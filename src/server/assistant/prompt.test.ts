import { describe, it, expect } from 'vitest';
import { buildAssistantSystemPrompt, pickAssistantAlias } from './prompt';

describe('buildAssistantSystemPrompt', () => {
  it('describes the tools and the no-confirmation behavior', () => {
    const s = buildAssistantSystemPrompt();
    expect(s).toContain('create_adr');
    expect(s).toContain('apply immediately');
  });

  it('mandates the ADR template with acceptance criteria', () => {
    const s = buildAssistantSystemPrompt();
    // Template sections
    expect(s).toContain('## Context');
    expect(s).toContain('## Decision');
    expect(s).toContain('## Consequences');
    // Canonical criteria section + verify-command guidance
    expect(s).toContain('## Acceptance criteria');
    expect(s).toContain('verify:');
    expect(s).toMatch(/objectively verifiable/i);
  });

  it('defines the refining-brainstorm protocol for ADR create/substantial-change', () => {
    const s = buildAssistantSystemPrompt();
    // Names the skill and its one-question-at-a-time discipline.
    expect(s).toMatch(/refining brainstorm/i);
    expect(s).toMatch(/one .*question at a time/i);
    // Covers all four dimensions.
    expect(s).toMatch(/problem|motivation/i);
    expect(s).toMatch(/decision/i);
    expect(s).toMatch(/consequences|trade-?offs/i);
    expect(s).toMatch(/acceptance criteria/i);
    // Has the recap/confirm-before-writing gate.
    expect(s).toMatch(/recap/i);
    expect(s).toMatch(/before .*writ/i);
    // Still scopes immediate writes for trivial/non-ADR work (boundary preserved).
    expect(s).toContain('apply immediately');
    expect(s).toMatch(/typo|trivial|small/i);
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
