import { describe, expect, it } from 'vitest';
import { adrTitle, humanize } from './text';

describe('humanize', () => {
  it('turns a slug id into words and drops a leading underscore', () => {
    expect(humanize('rotate-refresh-tokens')).toBe('rotate refresh tokens');
    expect(humanize('_architect')).toBe('architect');
  });
});

describe('adrTitle', () => {
  it('prefers the document title when present', () => {
    expect(adrTitle('adr-007', 'Rotate refresh tokens', '# Something else')).toBe(
      'Rotate refresh tokens',
    );
  });

  it('falls back to the first content heading, ignoring the injected criteria section', () => {
    const body = [
      '## Acceptance criteria',
      '',
      '- [ ] **ac-1** tokens rotate',
      '',
      '# Rotate refresh tokens',
    ].join('\n');
    expect(adrTitle('adr-007', '', body)).toBe('Rotate refresh tokens');
  });

  it('falls back to the humanized id when there is no title or heading', () => {
    expect(adrTitle('rotate-refresh-tokens', '', 'plain prose, no heading')).toBe(
      'rotate refresh tokens',
    );
  });
});
