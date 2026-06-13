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

/**
 * Run a criterion's `verify` command and resolve `true` iff it exits 0.
 *
 * This is what makes the convergence invariant *real* (spec §3): a criterion is
 * satisfied only when its command exits cleanly. The command runs through a shell
 * (so `npm test -- foo` and `&&` chains work) in the target repo (`cwd`).
 *
 * Failure modes all resolve to `false` rather than rejecting — a verify step is a
 * pass/fail signal, not an exception:
 *   - non-zero exit  -> false
 *   - spawn error    -> false
 *   - timeout        -> the process is killed and we resolve false
 *
 * The promise resolves exactly once; the timer is always cleared.
 */
export function runVerify(command: string, cwd: string, options: RunVerifyOptions = {}): Promise<boolean> {
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? resolveVerifyTimeoutMs(env);

  return new Promise<boolean>((resolve) => {
    const child = spawn(command, {
      cwd,
      env,
      shell: true,
      stdio: 'ignore',
    });

    let settled = false;
    const finish = (passed: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(passed);
    };

    const timer = setTimeout(() => {
      // Treat a hung command as a failed criterion. SIGKILL so it can't ignore us.
      child.kill('SIGKILL');
      finish(false);
    }, timeoutMs);
    // Don't let a pending verify timer keep the process alive on its own.
    if (typeof timer.unref === 'function') timer.unref();

    child.on('error', () => finish(false));
    child.on('close', (code) => finish(code === 0));
  });
}
