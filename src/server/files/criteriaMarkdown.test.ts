import { describe, it, expect } from 'vitest';
import type { AcceptanceCriterion } from '../../shared';
import {
  parseCriteriaFromBody,
  upsertCriteriaInBody,
  assignMissingIds,
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
});
