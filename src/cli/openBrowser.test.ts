import { describe, it, expect } from 'vitest';
import { browserCommand } from './openBrowser';

describe('browserCommand', () => {
  it('uses `open` on macOS', () => {
    expect(browserCommand('darwin', 'http://localhost:5174')).toEqual({
      cmd: 'open',
      args: ['http://localhost:5174'],
    });
  });

  it('uses `xdg-open` on Linux', () => {
    expect(browserCommand('linux', 'http://x')).toEqual({ cmd: 'xdg-open', args: ['http://x'] });
  });

  it('uses cmd start on Windows', () => {
    expect(browserCommand('win32', 'http://x')).toEqual({
      cmd: 'cmd',
      args: ['/c', 'start', '', 'http://x'],
    });
  });

  it('returns null for an unknown platform', () => {
    expect(browserCommand('aix', 'http://x')).toBeNull();
  });
});
