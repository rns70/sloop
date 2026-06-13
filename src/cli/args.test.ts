import { describe, it, expect } from 'vitest';
import { parseArgs } from './args';

describe('parseArgs', () => {
  it('defaults to the serve command', () => {
    expect(parseArgs([])).toEqual({ kind: 'serve', port: undefined, open: true });
  });

  it('parses the init command', () => {
    expect(parseArgs(['init'])).toEqual({ kind: 'init' });
  });

  it('parses --port for serve', () => {
    expect(parseArgs(['--port', '8080'])).toEqual({ kind: 'serve', port: 8080, open: true });
  });

  it('parses --no-open for serve', () => {
    expect(parseArgs(['--no-open'])).toEqual({ kind: 'serve', port: undefined, open: false });
  });

  it('treats --help and --version as their own commands', () => {
    expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseArgs(['--version'])).toEqual({ kind: 'version' });
  });

  it('rejects an unknown command', () => {
    expect(() => parseArgs(['frobnicate'])).toThrow(/unknown command/i);
  });

  it('rejects a non-numeric --port', () => {
    expect(() => parseArgs(['--port', 'abc'])).toThrow(/--port/);
  });

  describe('set-key', () => {
    it('defaults to anthropic + global with an inline key', () => {
      expect(parseArgs(['set-key', 'sk-ant-x'])).toEqual({
        kind: 'set-key', provider: 'anthropic', scope: 'global', value: 'sk-ant-x',
      });
    });

    it('leaves value undefined when none is given (stdin path)', () => {
      expect(parseArgs(['set-key'])).toEqual({
        kind: 'set-key', provider: 'anthropic', scope: 'global', value: undefined,
      });
    });

    it('parses --provider and --local in any order', () => {
      expect(parseArgs(['set-key', '--local', '--provider', 'nebius', 'nb'])).toEqual({
        kind: 'set-key', provider: 'nebius', scope: 'local', value: 'nb',
      });
    });

    it('rejects an unknown provider', () => {
      expect(() => parseArgs(['set-key', '--provider', 'openai', 'k'])).toThrow(/--provider/);
    });

    it('rejects an unknown set-key option', () => {
      expect(() => parseArgs(['set-key', '--bogus'])).toThrow(/unknown option/);
    });

    it('rejects a second positional argument', () => {
      expect(() => parseArgs(['set-key', 'a', 'b'])).toThrow(/unexpected argument/);
    });
  });
});
