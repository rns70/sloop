import { describe, expect, it } from 'vitest';
import { parseTask } from './taskLoader';

const VALID = `---
id: "001-add-rate-limit"
repo: api-service
baseRef: main
adrPath: loops/adr-020-rate-limit.md
heldOut:
  - "node --test test/heldout.test.js"
  - "npm run lint"
modelMixes:
  - { plan: opus, execute: haiku }
  - { plan: opus, execute: nemotron }
---
# Rate-limit the public API

Add a token-bucket limiter. Criteria with agent-visible verify commands go here.
`;

describe('parseTask', () => {
  it('parses a well-formed task file', () => {
    const t = parseTask(VALID, 'fallback');
    expect(t.id).toBe('001-add-rate-limit');
    expect(t.source).toBe('handmade');
    expect(t.repo).toBe('api-service');
    expect(t.baseRef).toBe('main');
    expect(t.adrPath).toBe('loops/adr-020-rate-limit.md');
    expect(t.heldOut).toEqual(['node --test test/heldout.test.js', 'npm run lint']);
    expect(t.modelMixes).toEqual([
      { plan: 'opus', execute: 'haiku' },
      { plan: 'opus', execute: 'nemotron' },
    ]);
    expect(t.title).toBe('Rate-limit the public API'); // from first heading
    expect(t.body).toContain('token-bucket limiter');
  });

  it('defaults baseRef to main when omitted', () => {
    const raw = VALID.replace('baseRef: main\n', '');
    expect(parseTask(raw, 'f').baseRef).toBe('main');
  });

  it('fails fast on a missing repo', () => {
    const raw = VALID.replace('repo: api-service\n', '');
    expect(() => parseTask(raw, 'f')).toThrow(/"repo"/);
  });

  it('rejects an empty held-out suite (convergence would be unfalsifiable)', () => {
    const raw = `---
id: x
repo: r
adrPath: loops/x.md
heldOut: []
modelMixes:
  - { plan: opus, execute: haiku }
---
# X
body
`;
    expect(() => parseTask(raw, 'f')).toThrow(/heldOut/);
  });

  it('rejects empty modelMixes', () => {
    const noMix = VALID.replace(/modelMixes:[\s\S]*?---/, 'modelMixes: []\n---');
    expect(() => parseTask(noMix, 'f')).toThrow(/modelMixes/);
  });
});
