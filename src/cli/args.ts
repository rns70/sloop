// Pure argv parser for the `sloop` CLI. Kept side-effect-free so it is trivially
// testable; the dispatcher (index.ts) turns these commands into actions.

export type Command =
  | { kind: 'serve'; port: number | undefined; open: boolean }
  | { kind: 'init' }
  | { kind: 'help' }
  | { kind: 'version' };

/** Parse process argv (without node + script). Throws on malformed input. */
export function parseArgs(argv: string[]): Command {
  if (argv.includes('--help') || argv.includes('-h')) return { kind: 'help' };
  if (argv.includes('--version') || argv.includes('-v')) return { kind: 'version' };

  const [first] = argv;
  if (first === 'init') return { kind: 'init' };
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
