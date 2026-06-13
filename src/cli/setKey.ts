// Persist a provider API key into a sloop `.sloop/.env` file so it need not be exported
// in the shell every run. Two scopes mirror the loader precedence (see loadSloopEnv):
//   - global: ~/.sloop/.env   (set once, used by every project)
//   - local:  <cwd>/.sloop/.env (scoped to one workspace; overrides global)
// The file is written 0600 (owner read/write only) — it holds a secret. Other keys and
// comments already in the file are preserved (upsertEnvLine). The `.env` gitignore
// pattern (no leading slash) matches at any depth, so a project `.sloop/.env` is ignored.

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { upsertEnvLine } from '../server/env';
import type { ProviderName } from '../shared/types';

/** Provider -> the env var its key lives under. Single source of truth for the CLI writer. */
export const PROVIDER_ENV_VAR: Record<ProviderName, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  nebius: 'NEBIUS_API_KEY',
};

export type KeyScope = 'global' | 'local';

export interface SetKeyOptions {
  provider: ProviderName;
  /** Raw key value; surrounding whitespace is trimmed. Must be non-empty. */
  value: string;
  scope: KeyScope;
  /** Project dir for `local` scope. Default: `process.cwd()`. */
  cwd?: string;
  /** Home dir for `global` scope. Default: `os.homedir()`. */
  home?: string;
}

/** Resolve the target env file: global `~/.sloop/.env` or project `<cwd>/.sloop/.env`. */
export function keyFilePath(scope: KeyScope, opts: { cwd?: string; home?: string } = {}): string {
  const base = scope === 'global' ? (opts.home ?? homedir()) : (opts.cwd ?? process.cwd());
  return path.join(base, '.sloop', '.env');
}

/**
 * Upsert a provider key into the scope's `.sloop/.env`, creating the `.sloop` dir if
 * needed, preserving any existing keys/comments, and enforcing 0600 perms (even when the
 * file already existed). Returns the absolute path written. Throws on an empty key.
 */
export async function setKey(options: SetKeyOptions): Promise<string> {
  const value = options.value.trim();
  if (!value) throw new Error('refusing to write an empty API key');

  const envVar = PROVIDER_ENV_VAR[options.provider];
  const file = keyFilePath(options.scope, options);
  await fs.mkdir(path.dirname(file), { recursive: true });

  let existing = '';
  try {
    existing = await fs.readFile(file, 'utf8');
  } catch {
    existing = ''; // First write — start from an empty file.
  }

  await fs.writeFile(file, upsertEnvLine(existing, envVar, value), { mode: 0o600 });
  await fs.chmod(file, 0o600); // writeFile's mode is ignored when the file pre-exists.
  return file;
}
