import { describe, it, expect, vi } from 'vitest';
import { run, type CliDeps } from './index';

function deps(over: Partial<CliDeps> = {}): CliDeps {
  return {
    cwd: '/proj',
    scaffold: vi.fn(async () => ({ created: ['.sloop/config.md'], gitInitialized: true })),
    isInitialized: vi.fn(async () => true),
    startServer: vi.fn(async () => ({ url: 'http://localhost:5174', uiMounted: true, close: async () => {} })),
    openBrowser: vi.fn(),
    setKey: vi.fn(async () => '/home/u/.sloop/.env'),
    readStdin: vi.fn(async () => ''),
    log: vi.fn(),
    version: '9.9.9',
    ...over,
  };
}

describe('run', () => {
  it('init scaffolds and does not start a server', async () => {
    const d = deps();
    await run(['init'], d);
    expect(d.scaffold).toHaveBeenCalledWith('/proj');
    expect(d.startServer).not.toHaveBeenCalled();
  });

  it('serve auto-initializes when uninitialized, then starts + opens', async () => {
    const d = deps({ isInitialized: vi.fn(async () => false) });
    await run([], d);
    expect(d.scaffold).toHaveBeenCalledWith('/proj');
    expect(d.startServer).toHaveBeenCalledWith({ root: '/proj', port: undefined });
    expect(d.openBrowser).toHaveBeenCalledWith('http://localhost:5174');
  });

  it('serve does NOT re-scaffold when already initialized', async () => {
    const d = deps({ isInitialized: vi.fn(async () => true) });
    await run([], d);
    expect(d.scaffold).not.toHaveBeenCalled();
    expect(d.startServer).toHaveBeenCalled();
  });

  it('serve --no-open skips the browser', async () => {
    const d = deps();
    await run(['--no-open'], d);
    expect(d.openBrowser).not.toHaveBeenCalled();
  });

  it('--version logs the version and starts nothing', async () => {
    const d = deps();
    await run(['--version'], d);
    expect(d.log).toHaveBeenCalledWith('9.9.9');
    expect(d.startServer).not.toHaveBeenCalled();
  });
});
