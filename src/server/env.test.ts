import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadDotEnv, loadSloopEnv, parseDotEnv, upsertEnvLine } from './env';

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

describe('loadSloopEnv', () => {
  let home: string;
  let proj: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'sloop-home-'));
    proj = mkdtempSync(join(tmpdir(), 'sloop-proj-'));
    mkdirSync(join(home, '.sloop'), { recursive: true });
    mkdirSync(join(proj, '.sloop'), { recursive: true });
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(proj, { recursive: true, force: true });
  });

  it('layers precedence: shell > .env > .sloop/.env > ~/.sloop/.env', () => {
    writeFileSync(join(home, '.sloop', '.env'), 'A=global\nB=global\nC=global\nD=global\n');
    writeFileSync(join(proj, '.sloop', '.env'), 'B=projsloop\nC=projsloop\n');
    writeFileSync(join(proj, '.env'), 'C=projenv\nD=projenv\n');
    const env: NodeJS.ProcessEnv = { D: 'shell' };

    loadSloopEnv({ cwd: proj, home, env });

    expect(env.A).toBe('global');     // only in ~/.sloop/.env
    expect(env.B).toBe('projsloop');  // .sloop/.env beats global
    expect(env.C).toBe('projenv');    // .env beats .sloop/.env and global
    expect(env.D).toBe('shell');      // shell env beats every file
  });

  it('is fail-soft when no files exist', () => {
    const env: NodeJS.ProcessEnv = {};
    expect(loadSloopEnv({ cwd: proj, home, env })).toEqual([]);
  });

  it('reads the global ~/.sloop/.env even with no project files', () => {
    writeFileSync(join(home, '.sloop', '.env'), 'ANTHROPIC_API_KEY=from-global\n');
    const env: NodeJS.ProcessEnv = {};
    const applied = loadSloopEnv({ cwd: proj, home, env });
    expect(env.ANTHROPIC_API_KEY).toBe('from-global');
    expect(applied).toContain('ANTHROPIC_API_KEY');
  });
});

describe('upsertEnvLine', () => {
  it('appends a new key to empty text with a trailing newline', () => {
    expect(upsertEnvLine('', 'K', 'v')).toBe('K=v\n');
  });

  it('replaces an existing key in place, preserving other lines and comments', () => {
    const text = '# header\nA=1\nK=old\nB=2\n';
    expect(upsertEnvLine(text, 'K', 'new')).toBe('# header\nA=1\nK=new\nB=2\n');
  });

  it('matches a key written with an export prefix', () => {
    expect(upsertEnvLine('export K=old\n', 'K', 'new')).toBe('K=new\n');
  });

  it('appends without leaving a blank gap after a newline-terminated file', () => {
    expect(upsertEnvLine('A=1\n', 'K', 'v')).toBe('A=1\nK=v\n');
  });

  it('does not match a key that only appears inside a comment', () => {
    expect(upsertEnvLine('# K=commented\n', 'K', 'v')).toBe('# K=commented\nK=v\n');
  });
});
