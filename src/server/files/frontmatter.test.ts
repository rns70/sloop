import { describe, it, expect } from 'vitest';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter';

const SAMPLE = `---
id: rotate-refresh-tokens
kind: leaf
role: engineer
model: haiku
status: planned
delta: change
parent: _architect
children: []
sourceAdr: adr-007
template: spec-driven
executor: pi
acceptanceCriteria:
  - id: ac-1
    text: "Refresh tokens rotate on every use and expire within ≤15 minutes."
    verify: "npm test -- rotation"
    passed: false
---

# Leaf — rotate-refresh-tokens

## Brief
Implement refresh-token rotation in the token service.
`;

describe('frontmatter', () => {
  it('round-trips parse -> serialize -> parse to an equal result', () => {
    const first = parseFrontmatter(SAMPLE);
    const reserialized = serializeFrontmatter(first.data, first.body);
    const second = parseFrontmatter(reserialized);

    expect(second.data).toEqual(first.data);
    expect(second.body).toEqual(first.body);
  });

  it('parses frontmatter into typed data and keeps the body verbatim', () => {
    const { data, body } = parseFrontmatter<{ id: string; children: string[] }>(SAMPLE);

    expect(data.id).toBe('rotate-refresh-tokens');
    expect(data.children).toEqual([]);
    expect(body).toContain('# Leaf — rotate-refresh-tokens');
  });

  it('omits undefined optional keys instead of emitting null', () => {
    const out = serializeFrontmatter(
      { id: 'x', parent: undefined, children: ['a'] },
      'body',
    );

    expect(out).not.toContain('parent');
    const { data } = parseFrontmatter<{ parent?: unknown }>(out);
    expect('parent' in data).toBe(false);
  });
});
