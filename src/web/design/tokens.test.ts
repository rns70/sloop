import { describe, it, expect } from 'vitest';
import { roleTone } from './tokens';

describe('roleTone', () => {
  it('maps the new roles to dedicated tones', () => {
    expect(roleTone('explorer')).toBe('teal');
    expect(roleTone('debugger')).toBe('amber');
  });

  it('keeps the existing role mapping and falls back to gray', () => {
    expect(roleTone('architect')).toBe('purple');
    expect(roleTone('unknown-role')).toBe('gray');
  });
});
