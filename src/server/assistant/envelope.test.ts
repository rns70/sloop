import { describe, it, expect } from 'vitest';
import { parseEnvelope } from './envelope';

describe('parseEnvelope', () => {
  it('parses a full create-role envelope', () => {
    const raw = [
      '<action>create-role</action>',
      '<summary>Create a security-reviewer role</summary>',
      '<path>.sloop/roles/security-reviewer.md</path>',
      '<content>', '---', 'id: security-reviewer', '---', 'Reviews diffs for vulns.', '</content>',
    ].join('\n');
    const p = parseEnvelope(raw);
    expect(p.action).toBe('create-role');
    expect(p.summary).toBe('Create a security-reviewer role');
    expect(p.targetPath).toBe('.sloop/roles/security-reviewer.md');
    expect(p.content).toContain('id: security-reviewer');
    expect(p.content.endsWith('Reviews diffs for vulns.')).toBe(true);
  });

  it('parses create-adr with a title', () => {
    const raw = '<action>create-adr</action>\n<title>Token rotation</title>\n' +
      '<path>databank/token-rotation.md</path>\n<content>\nRotate every 24h.\n</content>';
    const p = parseEnvelope(raw);
    expect(p.action).toBe('create-adr');
    expect(p.title).toBe('Token rotation');
    expect(p.content.trim()).toBe('Rotate every 24h.');
  });

  it('falls back to answer when no envelope is present', () => {
    const p = parseEnvelope('Sure — here is the answer in plain prose.');
    expect(p.action).toBe('answer');
    expect(p.content).toBe('Sure — here is the answer in plain prose.');
  });

  it('falls back to answer on an unknown action', () => {
    const p = parseEnvelope('<action>delete-everything</action>\n<content>nope</content>');
    expect(p.action).toBe('answer');
    expect(p.content).toBe('nope');
  });

  it('uses the action as a default summary when none is given', () => {
    const p = parseEnvelope('<action>edit</action>\n<path>databank/a.md</path>\n<content>new body</content>');
    expect(p.action).toBe('edit');
    expect(p.summary).toBe('edit');
  });
});
