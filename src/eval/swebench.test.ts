import { describe, expect, it } from 'vitest';
import { heldOutCommands, instanceToTask, parseSubset, type SwebenchInstance } from './swebench';
import type { ModelMix } from './types';

const MIXES: ModelMix[] = [{ plan: 'opus', execute: 'haiku' }];

function instance(overrides: Partial<SwebenchInstance> = {}): SwebenchInstance {
  return {
    instance_id: 'django__django-12345',
    repo: 'django/django',
    base_commit: 'abc123',
    problem_statement: 'Fix the thing that is broken in the ORM.',
    FAIL_TO_PASS: ['tests/test_orm.py::test_fixed'],
    PASS_TO_PASS: ['tests/test_orm.py::test_existing'],
    image: 'swebench/sweb.eval.x86_64.django__django-12345',
    ...overrides,
  };
}

describe('heldOutCommands', () => {
  it('builds one command per test group with the default pytest runner', () => {
    const cmds = heldOutCommands(instance());
    expect(cmds).toHaveLength(2);
    expect(cmds[0]).toContain('tests/test_orm.py::test_fixed');
    expect(cmds[1]).toContain('tests/test_orm.py::test_existing');
    expect(cmds[0]).toMatch(/pytest/);
  });

  it('honors a per-instance testCmd override', () => {
    const cmds = heldOutCommands(instance({ testCmd: 'tox -e py39 --' }));
    expect(cmds[0].startsWith('tox -e py39 --')).toBe(true);
  });
});

describe('instanceToTask', () => {
  it('maps a SWE-bench instance into the shared EvalTask shape', () => {
    const t = instanceToTask(instance(), MIXES);
    expect(t.source).toBe('swebench');
    expect(t.id).toBe('django__django-12345');
    expect(t.baseRef).toBe('abc123'); // base_commit
    expect(t.adrPath).toBe('databank/swebench-django__django-12345.md');
    expect(t.body).toContain('Fix the thing that is broken'); // problem_statement
    expect(t.heldOut.length).toBe(2); // hidden tests
    expect(t.swebench?.image).toContain('sweb.eval');
    expect(t.swebench?.repoPathInImage).toBe('/testbed'); // default
  });

  it('fails fast on missing required fields', () => {
    expect(() => instanceToTask(instance({ problem_statement: '' }), MIXES)).toThrow(/problem_statement/);
    expect(() => instanceToTask(instance({ base_commit: '' }), MIXES)).toThrow(/base_commit/);
    expect(() => instanceToTask(instance({ image: '' }), MIXES)).toThrow(/image/);
  });
});

describe('parseSubset', () => {
  it('requires a label and maps every instance', () => {
    const tasks = parseSubset({
      label: '2 tasks from SWE-bench Lite',
      defaultModelMixes: MIXES,
      instances: [instance(), instance({ instance_id: 'flask__flask-1' })],
    });
    expect(tasks).toHaveLength(2);
    expect(tasks[1].id).toBe('flask__flask-1');
  });

  it('rejects a missing label', () => {
    expect(() =>
      parseSubset({ label: '', defaultModelMixes: MIXES, instances: [instance()] }),
    ).toThrow(/label/);
  });

  it('caps the subset at 10 instances (spec §8)', () => {
    const many = Array.from({ length: 11 }, (_, i) => instance({ instance_id: `i-${i}` }));
    expect(() =>
      parseSubset({ label: 'too many', defaultModelMixes: MIXES, instances: many }),
    ).toThrow(/5–10|5-10|keep it to/);
  });
});
