import { describe, it, expect } from 'vitest';
import type { AcceptanceCriterion } from './types';
import {
  parseCriteriaFromBody,
  upsertCriteriaInBody,
  assignMissingIds,
  bodyHasNoCriteria,
  CRITERIA_HEADING,
} from './criteriaMarkdown';

const ac = (over: Partial<AcceptanceCriterion>): AcceptanceCriterion => ({
  id: 'ac-1',
  text: 'It works',
  passed: false,
  ...over,
});

describe('parseCriteriaFromBody', () => {
  it('returns no section when the heading is absent', () => {
    const r = parseCriteriaFromBody('# Title\n\nProse only.\n');
    expect(r.hasSection).toBe(false);
    expect(r.criteria).toEqual([]);
    expect(r.bodyWithoutSection).toBe('# Title\n\nProse only.');
  });

  it('parses id, text, passed, verify, and locked', () => {
    const body = [
      '# Title',
      '',
      'Prose.',
      '',
      CRITERIA_HEADING,
      '',
      '- [ ] **ac-1** Tokens rotate on every use. — verify: `npm test -- rotation` 🔒',
      '- [x] **ac-2** Old tokens are rejected.',
    ].join('\n');
    const r = parseCriteriaFromBody(body);
    expect(r.hasSection).toBe(true);
    expect(r.bodyWithoutSection).toBe('# Title\n\nProse.');
    expect(r.criteria).toEqual([
      { id: 'ac-1', text: 'Tokens rotate on every use.', passed: false, verify: 'npm test -- rotation', locked: true },
      { id: 'ac-2', text: 'Old tokens are rejected.', passed: true },
    ]);
  });

  it('stops the section at the next heading', () => {
    const body = [
      CRITERIA_HEADING,
      '',
      '- [ ] **ac-1** A.',
      '',
      '## Notes',
      '',
      'after',
    ].join('\n');
    const r = parseCriteriaFromBody(body);
    expect(r.criteria).toHaveLength(1);
    expect(r.bodyWithoutSection).toBe('## Notes\n\nafter');
  });
});

describe('assignMissingIds', () => {
  it('fills empty ids with the next free ac-N', () => {
    const out = assignMissingIds([
      ac({ id: 'ac-1' }),
      ac({ id: '', text: 'new one' }),
      ac({ id: 'ac-3' }),
      ac({ id: '   ', text: 'another' }),
    ]);
    expect(out.map((c) => c.id)).toEqual(['ac-1', 'ac-4', 'ac-3', 'ac-5']);
  });
});

describe('upsertCriteriaInBody', () => {
  it('appends a section when none exists', () => {
    const out = upsertCriteriaInBody('# Title\n\nProse.', [
      ac({ id: 'ac-1', text: 'A', verify: 'cmd' }),
    ]);
    expect(out).toBe(
      '# Title\n\nProse.\n\n' + CRITERIA_HEADING + '\n\n- [ ] **ac-1** A — verify: `cmd`\n',
    );
  });

  it('replaces an existing section in place', () => {
    const start = '# T\n\n' + CRITERIA_HEADING + '\n\n- [ ] **ac-1** Old\n';
    const out = upsertCriteriaInBody(start, [ac({ id: 'ac-1', text: 'New', passed: true })]);
    expect(out).toBe('# T\n\n' + CRITERIA_HEADING + '\n\n- [x] **ac-1** New\n');
  });

  it('removes the section when criteria is empty', () => {
    const start = '# T\n\n' + CRITERIA_HEADING + '\n\n- [ ] **ac-1** Old\n';
    expect(upsertCriteriaInBody(start, [])).toBe('# T\n');
  });

  it('assigns ids to criteria that lack them', () => {
    const out = upsertCriteriaInBody('', [ac({ id: '', text: 'first' })]);
    expect(out).toBe(CRITERIA_HEADING + '\n\n- [ ] **ac-1** first\n');
  });

  it('is idempotent (round-trips through parse)', () => {
    const once = upsertCriteriaInBody('# T\n\nProse.', [
      ac({ id: 'ac-1', text: 'A', verify: 'cmd', locked: true }),
      ac({ id: 'ac-2', text: 'B', passed: true }),
    ]);
    const parsed = parseCriteriaFromBody(once);
    const twice = upsertCriteriaInBody(once, parsed.criteria);
    expect(twice).toBe(once);
  });
});

describe('parser tolerance (BlockNote-style output)', () => {
  it('accepts an en-dash or hyphen before verify', () => {
    const enDash = parseCriteriaFromBody(CRITERIA_HEADING + '\n\n- [ ] **ac-1** A – verify: `cmd`');
    const hyphen = parseCriteriaFromBody(CRITERIA_HEADING + '\n\n- [ ] **ac-1** A - verify: `cmd`');
    expect(enDash.criteria[0]).toEqual({ id: 'ac-1', text: 'A', passed: false, verify: 'cmd' });
    expect(hyphen.criteria[0]).toEqual({ id: 'ac-1', text: 'A', passed: false, verify: 'cmd' });
  });

  it('accepts uppercase [X] and extra surrounding whitespace', () => {
    const r = parseCriteriaFromBody(CRITERIA_HEADING + '\n\n   - [X]   **ac-1**   A   ');
    expect(r.criteria[0]).toEqual({ id: 'ac-1', text: 'A', passed: true });
  });

  it('parses a criterion with no id (hand-added bullet)', () => {
    const r = parseCriteriaFromBody(CRITERIA_HEADING + '\n\n- [ ] just text');
    expect(r.criteria[0]).toEqual({ id: '', text: 'just text', passed: false });
  });

  it('does not treat non-ac bold text as an id', () => {
    const r = parseCriteriaFromBody(CRITERIA_HEADING + '\n\n- [ ] **important** do the thing');
    expect(r.criteria[0]).toEqual({ id: '', text: '**important** do the thing', passed: false });
  });
});

describe('upsertCriteriaInBody validation', () => {
  it('throws when a verify command contains a backtick', () => {
    expect(() =>
      upsertCriteriaInBody('', [{ id: 'ac-1', text: 'A', passed: false, verify: 'echo `date`' }]),
    ).toThrow(/backtick/);
  });
});

describe('fenced code blocks are ignored', () => {
  it('does not match a heading or bullets inside a fenced block', () => {
    const body = [
      '# Doc',
      '',
      'Example of the format:',
      '',
      '```markdown',
      '## Acceptance criteria',
      '',
      '- [ ] **ac-1** not a real criterion',
      '```',
      '',
      'Real prose after.',
    ].join('\n');
    const r = parseCriteriaFromBody(body);
    expect(r.hasSection).toBe(false);
    expect(r.criteria).toEqual([]);
    // the fenced example is preserved verbatim in the remaining body
    expect(r.bodyWithoutSection).toContain('```markdown');
    expect(r.bodyWithoutSection).toContain('## Acceptance criteria');
    expect(r.bodyWithoutSection).toContain('Real prose after.');
  });

  it('parses the real section while leaving a fenced example untouched', () => {
    const body = [
      '# Doc',
      '',
      '```',
      '## Acceptance criteria',
      '- [ ] **ac-9** fake inside fence',
      '```',
      '',
      '## Acceptance criteria',
      '',
      '- [x] **ac-1** real one',
    ].join('\n');
    const r = parseCriteriaFromBody(body);
    expect(r.hasSection).toBe(true);
    expect(r.criteria).toEqual([{ id: 'ac-1', text: 'real one', passed: true }]);
    expect(r.bodyWithoutSection).toContain('```');
    expect(r.bodyWithoutSection).toContain('**ac-9** fake inside fence');
  });
});

describe('upsertCriteriaInBody — plain style', () => {
  it('renders plain checklist items: no id, no lock, keeps checkbox + verify', () => {
    const out = upsertCriteriaInBody(
      '# T\n',
      [
        ac({ id: 'ac-1', text: 'It works', passed: false, locked: true }),
        ac({ id: 'ac-2', text: 'Tests pass', passed: true, verify: 'npm test' }),
      ],
      'plain',
    );
    expect(out).toBe(
      '# T\n\n' +
        CRITERIA_HEADING +
        '\n\n- [ ] It works\n- [x] Tests pass — verify: `npm test`\n',
    );
  });

  it('does not assign ids in plain style (empty id stays empty)', () => {
    const out = upsertCriteriaInBody('', [ac({ id: '', text: 'A' })], 'plain');
    expect(out).toBe(CRITERIA_HEADING + '\n\n- [ ] A\n');
  });

  it('full style is unchanged (default) — still emits **ac-N** and 🔒', () => {
    const out = upsertCriteriaInBody('', [ac({ id: 'ac-1', text: 'A', locked: true })]);
    expect(out).toBe(CRITERIA_HEADING + '\n\n- [ ] **ac-1** A 🔒\n');
  });
});

describe('bodyHasNoCriteria', () => {
  it('is true when there is no criteria section at all', () => {
    expect(bodyHasNoCriteria('# Title\n\nProse only.\n')).toBe(true);
  });

  it('is true when the section heading exists but has no items', () => {
    expect(bodyHasNoCriteria('# Title\n\n## Acceptance criteria\n\n')).toBe(true);
  });

  it('is false when the section has at least one item', () => {
    expect(bodyHasNoCriteria('## Acceptance criteria\n\n- [ ] It works\n')).toBe(false);
  });

  it('is true when the only checklist lives inside a fenced code block', () => {
    const body = '## Acceptance criteria\n\n```\n- [ ] not a real criterion\n```\n';
    expect(bodyHasNoCriteria(body)).toBe(true);
  });
});
