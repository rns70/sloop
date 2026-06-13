// Minimal, dependency-free `.env` loader.
//
// sloop reads provider keys (ANTHROPIC_API_KEY, NEBIUS_API_KEY) and runtime config
// from the environment. In development those live in a gitignored `.env`; in prod they
// come from the real environment / a secret manager. This loader bridges the two without
// pulling in a dependency: it parses a `.env` file if present and populates `process.env`
// — but only for keys that are NOT already set, so the real shell environment always wins
// (dev/prod parity: the same code path, the file is just a convenience that defers to real
// config when present). A missing file is a no-op, not an error.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Strip surrounding matching quotes from a value, if any. */
function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Parse `.env`-style text into key/value pairs. Supports `KEY=value`, `export KEY=value`,
 * blank lines, `#` comments, and single/double-quoted values. Lines without `=` are skipped.
 * Pure (no I/O) so it is trivially testable.
 */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const withoutExport = line.startsWith('export ') ? line.slice('export '.length) : line;
    const eq = withoutExport.indexOf('=');
    if (eq === -1) continue;
    const key = withoutExport.slice(0, eq).trim();
    if (!key) continue;
    out[key] = unquote(withoutExport.slice(eq + 1));
  }
  return out;
}

export interface LoadDotEnvOptions {
  /** Path to the env file. Default: `.env` resolved against `cwd`. */
  path?: string;
  /** Base dir for a relative `path`. Default: `process.cwd()`. */
  cwd?: string;
  /** Target env map to populate. Default: `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Load a `.env` file into `env`, setting only keys that are not already present so a real
 * shell/host environment always takes precedence. Returns the keys actually applied (for
 * a boot log). Fail-soft: a missing or unreadable file yields `[]`.
 */
export function loadDotEnv(options: LoadDotEnvOptions = {}): string[] {
  const env = options.env ?? process.env;
  const file = resolve(options.cwd ?? process.cwd(), options.path ?? '.env');

  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return []; // No file (or unreadable) — nothing to load.
  }

  const applied: string[] = [];
  for (const [key, value] of Object.entries(parseDotEnv(text))) {
    if (env[key] === undefined) {
      env[key] = value;
      applied.push(key);
    }
  }
  return applied;
}

export interface LoadSloopEnvOptions {
  /** Project dir whose `.env` and `.sloop/.env` are read. Default: `process.cwd()`. */
  cwd?: string;
  /** Home dir whose `.sloop/.env` is read (the global key store). Default: `os.homedir()`. */
  home?: string;
  /** Target env map to populate. Default: `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Load provider keys/config from sloop's layered env files, in order of DECREASING
 * precedence. Each layer only fills keys still unset (see `loadDotEnv`), so the real
 * shell environment — already populated before this runs — always wins, and earlier
 * (higher-precedence) files shadow later ones:
 *
 *   1. shell environment        (already present; never overwritten)
 *   2. `<cwd>/.env`             (project root — dev convenience, existing behavior)
 *   3. `<cwd>/.sloop/.env`      (project-scoped sloop config)
 *   4. `~/.sloop/.env`          (global sloop config — set once via `sloop set-key`)
 *
 * Returns the keys actually applied across all layers (for a boot log). Fail-soft:
 * missing files are skipped.
 */
export function loadSloopEnv(options: LoadSloopEnvOptions = {}): string[] {
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? homedir();
  const env = options.env ?? process.env;

  return [
    ...loadDotEnv({ path: '.env', cwd, env }),
    ...loadDotEnv({ path: join('.sloop', '.env'), cwd, env }),
    ...loadDotEnv({ path: join(home, '.sloop', '.env'), env }),
  ];
}

/**
 * Return `text` with `KEY=value` upserted: if a non-comment line already assigns `key`
 * (with or without a leading `export`), its value is replaced in place; otherwise a new
 * `KEY=value` line is appended. All other lines — comments, blanks, unrelated keys — are
 * preserved verbatim, and the result always ends with a single trailing newline. Pure
 * (no I/O), so the file writer can be tested separately from the rewrite logic.
 */
export function upsertEnvLine(text: string, key: string, value: string): string {
  const lines = text.split(/\r?\n/);
  // Drop the single trailing blank that splitting a newline-terminated file produces, so
  // neither the replace nor the append path leaves a stray blank line; we re-add exactly
  // one trailing newline at the end.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  let replaced = false;
  const out = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;
    const withoutExport = trimmed.startsWith('export ') ? trimmed.slice('export '.length) : trimmed;
    const eq = withoutExport.indexOf('=');
    if (eq === -1 || withoutExport.slice(0, eq).trim() !== key) return line;
    replaced = true;
    return `${key}=${value}`;
  });

  if (!replaced) out.push(`${key}=${value}`);

  return `${out.join('\n')}\n`;
}
