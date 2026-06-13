// WP-3 Executor — the single, provider-agnostic Pi-backed Executor + verify helper.
// WP-2 injects `createExecutor` into the cascade engine; WP-6 wires it with the real registry.
export { createExecutor, buildModel, buildBrief, DEFAULT_EXECUTOR_TIMEOUT_MS } from './piExecutor';
export { runVerify, resolveVerifyTimeoutMs, DEFAULT_VERIFY_TIMEOUT_MS } from './verify';
export type { RunVerifyOptions } from './verify';
