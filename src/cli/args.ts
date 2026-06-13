// Pure argv parser for the `sloop` CLI. Kept side-effect-free so it is trivially
// testable; the dispatcher (index.ts) turns these commands into actions.

import type { ProviderName } from '../shared/types';
import type { KeyScope } from './setKey';

export type Command =
  | { kind: 'serve'; port: number | undefined; open: boolean }
  | { kind: 'init' }
  | { kind: 'set-key'; provider: ProviderName; scope: KeyScope; value: string | undefined }
  | { kind: 'help' }
  | { kind: 'version' };

const PROVIDERS: readonly ProviderName[] = ['anthropic', 'nebius'];

/** Parse the `set-key` subcommand args (everything after `set-key`). */
function parseSetKey(rest: string[]): Command {
  let provider: ProviderName = 'anthropic';
  let scope: KeyScope = 'global';
  let value: string | undefined;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--local') {
      scope = 'local';
    } else if (arg === '--global') {
      scope = 'global';
    } else if (arg === '--provider') {
      const raw = rest[i + 1];
      if (!raw || !PROVIDERS.includes(raw as ProviderName)) {
        throw new Error(`--provider expects one of ${PROVIDERS.join('|')}, got: ${raw ?? '(missing)'}`);
      }
      provider = raw as ProviderName;
      i += 1;
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown option: ${arg}`);
    } else if (value === undefined) {
      value = arg;
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }
  return { kind: 'set-key', provider, scope, value };
}

/** Parse process argv (without node + script). Throws on malformed input. */
export function parseArgs(argv: string[]): Command {
  if (argv.includes('--help') || argv.includes('-h')) return { kind: 'help' };
  if (argv.includes('--version') || argv.includes('-v')) return { kind: 'version' };

  const [first] = argv;
  if (first === 'init') return { kind: 'init' };
  if (first === 'set-key') return parseSetKey(argv.slice(1));
  if (first !== undefined && !first.startsWith('-')) {
    throw new Error(`unknown command: ${first}`);
  }

  // Default command: serve.
  let port: number | undefined;
  let open = true;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--no-open') {
      open = false;
    } else if (arg === '--port') {
      const raw = argv[i + 1];
      const parsed = Number(raw);
      if (!raw || !Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`--port expects a positive integer, got: ${raw ?? '(missing)'}`);
      }
      port = parsed;
      i += 1;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return { kind: 'serve', port, open };
}
