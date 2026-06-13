import { describe, it, expect } from 'vitest';
import {
  createLogger,
  resolveLogLevel,
  DEFAULT_LOG_LEVEL,
  type LogLevel,
} from './log';

/** A logger writing to an in-memory buffer, color off, with a fixed timestamp. */
function makeLogger(level: LogLevel) {
  const chunks: string[] = [];
  const log = createLogger({
    level,
    color: false,
    now: () => '2026-06-13T00:00:00.000Z',
    out: (c) => chunks.push(c),
  });
  return { log, output: () => chunks.join('') };
}

describe('resolveLogLevel', () => {
  it('defaults when unset', () => {
    expect(resolveLogLevel({})).toBe(DEFAULT_LOG_LEVEL);
  });

  it('parses a valid level case-insensitively', () => {
    expect(resolveLogLevel({ SLOOP_LOG_LEVEL: 'DEBUG' })).toBe('debug');
    expect(resolveLogLevel({ SLOOP_LOG_LEVEL: ' warn ' })).toBe('warn');
  });

  it('falls back to the default on an unknown value', () => {
    expect(resolveLogLevel({ SLOOP_LOG_LEVEL: 'verbose' })).toBe(DEFAULT_LOG_LEVEL);
  });
});

describe('level gating', () => {
  it('info level prints error/warn/info but drops debug', () => {
    const { log, output } = makeLogger('info');
    log.error('e');
    log.warn('w');
    log.info('i');
    log.debug('d');
    const out = output();
    expect(out).toContain('e');
    expect(out).toContain('w');
    expect(out).toContain('i');
    expect(out).not.toContain(' [sloop] d');
  });

  it('silent prints nothing, including streamed output', () => {
    const { log, output } = makeLogger('silent');
    log.error('e');
    log.info('i');
    log.stream('raw agent text');
    expect(output()).toBe('');
  });

  it('debug prints every level', () => {
    const { log, output } = makeLogger('debug');
    log.debug('trace me');
    expect(output()).toContain('trace me');
  });
});

describe('formatting', () => {
  it('emits timestamp, padded level, prefix, message, then fields', () => {
    const { log, output } = makeLogger('info');
    log.info('loop x: queued → executing', { cascade: 'c1', role: 'engineer' });
    expect(output()).toBe(
      '2026-06-13T00:00:00.000Z info  [sloop] loop x: queued → executing cascade=c1 role=engineer\n',
    );
  });

  it('drops null/undefined fields and JSON-encodes objects', () => {
    const { log, output } = makeLogger('info');
    log.info('msg', { a: undefined, b: null, c: { x: 1 } });
    expect(output()).toBe('2026-06-13T00:00:00.000Z info  [sloop] msg c={"x":1}\n');
  });
});

describe('child loggers', () => {
  it('merges parent context into every line, child overrides on key clash', () => {
    const { log, output } = makeLogger('info');
    const child = log.child({ cascade: 'c1' });
    child.info('a');
    child.info('b', { cascade: 'c2', loop: 'l1' });
    const lines = output().trimEnd().split('\n');
    expect(lines[0]).toContain('cascade=c1');
    expect(lines[1]).toContain('cascade=c2');
    expect(lines[1]).toContain('loop=l1');
  });
});

describe('stream line-state', () => {
  it('streams raw text without a prefix at info level', () => {
    const { log, output } = makeLogger('info');
    log.stream('hello ');
    log.stream('world');
    expect(output()).toBe('hello world');
  });

  it('breaks out of a half-written streamed chunk before a prefixed line', () => {
    const { log, output } = makeLogger('info');
    log.stream('partial token without newline');
    log.info('status');
    const out = output();
    // A newline is injected so the log line does not append to the streamed text.
    expect(out).toBe(
      'partial token without newline\n2026-06-13T00:00:00.000Z info  [sloop] status\n',
    );
  });

  it('does not inject an extra newline when the stream already ended one', () => {
    const { log, output } = makeLogger('info');
    log.stream('line\n');
    log.info('next');
    expect(output()).toBe('line\n2026-06-13T00:00:00.000Z info  [sloop] next\n');
  });
});
