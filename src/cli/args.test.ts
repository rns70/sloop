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
});
