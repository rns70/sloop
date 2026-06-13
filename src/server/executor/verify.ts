import { spawn } from 'node:child_process';

/** Default per-criterion verify timeout. Overridable via SLOOP_VERIFY_TIMEOUT_MS. */
export const DEFAULT_VERIFY_TIMEOUT_MS = 120_000;

/**
 * Resolve the verify timeout from the environment, falling back to the default.
 * A non-numeric / non-positive value is treated as "unset" (fail-safe to default)
 * rather than silently becoming 0ms (which would fail every command instantly).
 */
export function resolveVerifyTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SLOOP_VERIFY_TIMEOUT_MS;
  if (raw === undefined || raw === '') return DEFAULT_VERIFY_TIMEOUT_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_VERIFY_TIMEOUT_MS;
}

export interface RunVerifyOptions {
  /** Hard timeout in ms. Defaults to {@link resolveVerifyTimeoutMs}. */
  timeoutMs?: number;
  /** Environment passed to the spawned shell. Defaults to the current process env. */
  env?: NodeJS.ProcessEnv;
}

/** Outcome of a single verify command: pass/fail plus the captured output that explains it. */
export interface VerifyResult {
  passed: boolean;
  /**
   * Combined stdout+stderr (tail-capped), so a failure can be surfaced to the user and
   * fed back to the agent. Empty when the command emitted nothing.
   */
  output: string;
  /** Process exit code, or null if it never produced one (spawn error / timeout / signal). */
  exitCode: number | null;
}

/**
 * True when a verify command was never actually a runnable command — the shell could not
 * find it (exit 127, the POSIX "command not found" code). This is the signature of a
 * criterion whose `verify:` field holds plain-English prose instead of a shell command;
 * retrying can NEVER fix it, so callers should flag it as a misconfiguration, not a normal
 * test failure. Exported so the executor can short-circuit on it.
 */
export function isCommandNotFound(result: VerifyResult): boolean {
  return result.exitCode === 127;
}

/** A single criterion that failed verification, with the evidence needed to fix it. */
export interface CriterionFailure {
  id: string;
  text: string;
  command: string;
  /** Captured stdout+stderr from the failed command (tail-capped); may be empty. */
  output: string;
  /**
   * True when the command was not found (exit 127) — i.e. the `verify:` field is almost
   * certainly prose, not a runnable command. An unfixable authoring error, not a code bug.
   */
  notRunnable: boolean;
}

/** Aggregate result of verifying all of a leaf's criteria. */
export interface VerifyOutcome {
  /** True iff every *verifiable* criterion passed (a leaf with none is vacuously ok). */
  ok: boolean;
  failures: CriterionFailure[];
}

/** Cap captured output so a chatty command can't blow up logs or the retry brief. */
const MAX_OUTPUT_CHARS = 4_000;

/** Keep the TAIL of the output — errors/assertions print last and matter most. */
function tailCap(s: string): string {
  const trimmed = s.trim();
  if (trimmed.length <= MAX_OUTPUT_CHARS) return trimmed;
  return `…(truncated)…\n${trimmed.slice(trimmed.length - MAX_OUTPUT_CHARS)}`;
}

/**
 * Run a criterion's `verify` command and resolve `{ passed, output }`. `passed` is true
 * iff the command exits 0 — this is what makes the convergence invariant *real* (spec §3).
 * The command runs through a shell (so `npm test -- foo` and `&&` chains work) in `cwd`,
 * and its stdout+stderr are captured so a failure is no longer opaque.
 *
 * Failure modes all resolve to `passed: false` rather than rejecting — a verify step is a
 * pass/fail signal, not an exception:
 *   - non-zero exit  -> { passed: false, output: <captured> }
 *   - spawn error    -> { passed: false, output: <error message> }
 *   - timeout        -> the process is killed; output notes the timeout
 *
 * The promise resolves exactly once; the timer is always cleared.
 */
export function runVerify(command: string, cwd: string, options: RunVerifyOptions = {}): Promise<VerifyResult> {
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? resolveVerifyTimeoutMs(env);

  return new Promise<VerifyResult>((resolve) => {
    const child = spawn(command, {
      cwd,
      env,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let captured = '';
    const append = (chunk: Buffer): void => {
      // Bound memory: once well past the cap, stop accumulating (we tail-cap anyway).
      if (captured.length < MAX_OUTPUT_CHARS * 4) captured += chunk.toString('utf8');
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);

    let settled = false;
    const finish = (passed: boolean, exitCode: number | null, extra = ''): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ passed, output: tailCap(captured + extra), exitCode });
    };

    const timer = setTimeout(() => {
      // Treat a hung command as a failed criterion. SIGKILL so it can't ignore us.
      child.kill('SIGKILL');
      finish(false, null, `\n[verify timed out after ${timeoutMs}ms]`);
    }, timeoutMs);
    // Don't let a pending verify timer keep the process alive on its own.
    if (typeof timer.unref === 'function') timer.unref();

    // ENOENT here means the shell itself couldn't spawn — surface it as not-runnable (127).
    child.on('error', (err) => finish(false, 127, `\n[spawn error] ${err.message}`));
    child.on('close', (code) => finish(code === 0, code));
  });
}
