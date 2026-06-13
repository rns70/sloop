import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadDotEnv, parseDotEnv } from './env';

describe('parseDotEnv', () => {
  it('parses KEY=value, export, comments, blanks, and quotes', () => {
    const text = [
      '# a comment',
      '',
      'PLAIN=value',
      'export EXPORTED=fromExport',
      'DQUOTED="double quoted"',
      "SQUOTED='single quoted'",
      'EMPTY=',
      'WITH_EQUALS=a=b=c',
      'no_equals_line_is_skipped',
      '   SPACED  =  trimmed  ',
    ].join('\n');

    expect(parseDotEnv(text)).toEqual({
      PLAIN: 'value',
      EXPORTED: 'fromExport',
      DQUOTED: 'double quoted',
      SQUOTED: 'single quoted',
      EMPTY: '',
      WITH_EQUALS: 'a=b=c',
      SPACED: 'trimmed',
    });
  });

  it('returns {} for empty or comment-only input', () => {
    expect(parseDotEnv('')).toEqual({});
    expect(parseDotEnv('# just a comment\n\n')).toEqual({});
  });
});

describe('loadDotEnv', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sloop-env-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('applies file values for keys not already set and reports them', () => {
    writeFileSync(join(dir, '.env'), 'NEW_KEY=fromFile\nOTHER=two\n');
    const env: NodeJS.ProcessEnv = {};
    const applied = loadDotEnv({ cwd: dir, env });
    expect(env.NEW_KEY).toBe('fromFile');
    expect(env.OTHER).toBe('two');
    expect(applied.sort()).toEqual(['NEW_KEY', 'OTHER']);
  });

  it('never overrides an already-set var (real shell env wins)', () => {
    writeFileSync(join(dir, '.env'), 'ANTHROPIC_API_KEY=fromFile\n');
    const env: NodeJS.ProcessEnv = { ANTHROPIC_API_KEY: 'fromShell' };
    const applied = loadDotEnv({ cwd: dir, env });
    expect(env.ANTHROPIC_API_KEY).toBe('fromShell');
    expect(applied).toEqual([]);
  });

  it('is a no-op when the file is missing', () => {
    const env: NodeJS.ProcessEnv = {};
    expect(loadDotEnv({ cwd: dir, env })).toEqual([]);
    expect(Object.keys(env)).toEqual([]);
  });

  it('honors an explicit path', () => {
    writeFileSync(join(dir, 'custom.env'), 'FROM_CUSTOM=1\n');
    const env: NodeJS.ProcessEnv = {};
    loadDotEnv({ path: 'custom.env', cwd: dir, env });
    expect(env.FROM_CUSTOM).toBe('1');
  });
});
