// Leveled, structured console logger for the sloop CLI/server process. Every progress
// update a user sees in the terminal flows through here, so it is the single place that
// decides verbosity (SLOOP_LOG_LEVEL), formatting, and color.
//
// Two kinds of output share one stream and must not garble each other:
//   - log.info/warn/error/debug(msg, fields) — a discrete, timestamped, prefixed line.
//   - log.stream(text)                        — raw passthrough of streamed agent/executor
//                                               output (token deltas, [tool], [verify]),
//                                               written WITHOUT a per-line prefix so the
//                                               agent's prose reads naturally.
// A shared sink tracks whether the cursor is mid-line so a prefixed line that interrupts a
// half-written streamed chunk first emits a newline — streamed prose and log lines never
// collide on the same row.
//
// Browser code must NOT import this module: it touches process.* and writes to a stdout
// sink. Keep it server/CLI-only (src/server, src/cli, scripts).

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

/** Higher rank = more verbose. A message at level L prints when L's rank <= active rank. */
const LEVEL_RANK: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

const LEVELS = Object.keys(LEVEL_RANK) as LogLevel[];

/** Default level when SLOOP_LOG_LEVEL is unset or unrecognized. */
export const DEFAULT_LOG_LEVEL: LogLevel = 'info';

/** Parse SLOOP_LOG_LEVEL (case-insensitive) into a LogLevel, falling back to the default. */
export function resolveLogLevel(env: NodeJS.ProcessEnv): LogLevel {
  const raw = (env.SLOOP_LOG_LEVEL ?? '').trim().toLowerCase();
  return (LEVELS as string[]).includes(raw) ? (raw as LogLevel) : DEFAULT_LOG_LEVEL;
}

export interface Logger {
  /** The active threshold; messages above it are dropped. */
  readonly level: LogLevel;
  error(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  debug(msg: string, fields?: Record<string, unknown>): void;
  /** Raw passthrough for streamed output (no prefix/newline added). Gated at >= info. */
  stream(text: string): void;
  /** Derive a logger that merges `context` into every message's fields. */
  child(context: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Sink for a fully-formatted chunk (may or may not end in a newline). Default: stdout. */
  out?: (chunk: string) => void;
  /** ISO timestamp source — injected so tests are deterministic. Default: wall clock. */
  now?: () => string;
  /** Whether to emit ANSI color. Default: out is a TTY. */
  color?: boolean;
}

// ---- ANSI helpers (no dependency; inert when color is off) ------------------

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const;

const LEVEL_COLOR: Record<Exclude<LogLevel, 'silent'>, string> = {
  error: ANSI.red,
  warn: ANSI.yellow,
  info: ANSI.cyan,
  debug: ANSI.gray,
};

/**
 * A line-aware writer shared by all loggers built from one root, so a `child()` and its
 * parent interleave coherently. Tracks the at-line-start flag across raw and prefixed
 * writes; that state is the whole reason streamed agent text and log lines don't collide.
 */
interface Sink {
  /** Emit a complete line, first breaking out of any half-written streamed chunk. */
  writeLine(line: string): void;
  /** Emit raw text verbatim (streamed output); updates line-state from its last char. */
  writeRaw(text: string): void;
}

function createSink(out: (chunk: string) => void): Sink {
  let atLineStart = true;
  return {
    writeLine(line) {
      if (!atLineStart) out('\n');
      out(line.endsWith('\n') ? line : line + '\n');
      atLineStart = true;
    },
    writeRaw(text) {
      if (!text) return;
      out(text);
      atLineStart = text.endsWith('\n');
    },
  };
}

/** Render `key=value` pairs; objects/arrays are JSON-encoded, undefined/null dropped. */
function formatFields(fields: Record<string, unknown> | undefined, color: boolean): string {
  if (!fields) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    const rendered =
      typeof value === 'object' ? JSON.stringify(value) : String(value);
    parts.push(`${key}=${rendered}`);
  }
  if (parts.length === 0) return '';
  const joined = parts.join(' ');
  return ' ' + (color ? `${ANSI.dim}${joined}${ANSI.reset}` : joined);
}

function createLoggerWith(
  sink: Sink,
  rank: number,
  level: LogLevel,
  now: () => string,
  color: boolean,
  context: Record<string, unknown>,
): Logger {
  const emit = (
    msgLevel: Exclude<LogLevel, 'silent'>,
    msg: string,
    fields?: Record<string, unknown>,
  ): void => {
    if (LEVEL_RANK[msgLevel] > rank) return;
    const ts = color ? `${ANSI.dim}${now()}${ANSI.reset}` : now();
    const tag = color
      ? `${LEVEL_COLOR[msgLevel]}${msgLevel}${ANSI.reset}`
      : msgLevel;
    // `info` is 4 chars, pad shorter labels so columns align (error/warn/info/debug).
    const label = tag + ' '.repeat(Math.max(0, 5 - msgLevel.length));
    const merged = { ...context, ...fields };
    sink.writeLine(`${ts} ${label} [sloop] ${msg}${formatFields(merged, color)}`);
  };

  return {
    level,
    error: (msg, fields) => emit('error', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    debug: (msg, fields) => emit('debug', msg, fields),
    stream: (text) => {
      // Streamed agent output is part of the "info" progress picture; suppress it once the
      // operator dials the level below info (warn/error/silent) to quiet a run.
      if (rank < LEVEL_RANK.info) return;
      sink.writeRaw(text);
    },
    child: (childContext) =>
      createLoggerWith(sink, rank, level, now, color, { ...context, ...childContext }),
  };
}

/** Build a logger. All collaborators are injectable so the formatting is unit-testable. */
export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? DEFAULT_LOG_LEVEL;
  const out = options.out ?? ((chunk: string) => process.stdout.write(chunk));
  const now = options.now ?? (() => new Date().toISOString());
  const color = options.color ?? Boolean((process.stdout as { isTTY?: boolean }).isTTY);
  return createLoggerWith(createSink(out), LEVEL_RANK[level], level, now, color, {});
}

// ---- Process-wide singleton -------------------------------------------------
// The CLI configures this once at startup from SLOOP_LOG_LEVEL; server modules read it via
// getLogger() so they share one sink (coherent line-state) and one level.

let active: Logger = createLogger({ level: resolveLogLevel(process.env) });

/** The process logger. Defaults to env-derived level until `configureLogger` overrides it. */
export function getLogger(): Logger {
  return active;
}

/** Replace the process logger (called once at CLI/server startup). Returns the new logger. */
export function configureLogger(options: LoggerOptions = {}): Logger {
  active = createLogger(options);
  return active;
}
