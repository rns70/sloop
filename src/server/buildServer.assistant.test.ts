import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { buildServer } from './buildServer';
import type { StreamingSloopApi } from './api/real';
import type { AssistantChatRequest, AssistantStreamEvent } from '../shared/index';

/**
 * Regression for the assistant "does nothing, no logs" bug. The SSE route used
 * `req.on('close')` to abort the agent, which fires the instant body-parser
 * finishes reading the POST body — aborting before the agent's first iteration,
 * so the turn ended with an empty `done` and zero text. The route must abort on
 * the *response* close, not the request close.
 *
 * This fake api emits its first event only on the NEXT tick (mirroring the real
 * stream, whose first chunk arrives asynchronously). With the req-close bug, the
 * recorded `abortedAtFirstTick` would be true and no text would reach the client.
 */
function buildFakeApi(record: { abortedAtFirstTick: boolean | null }): StreamingSloopApi {
  const api = {
    async assistantStream(
      _req: AssistantChatRequest,
      onEvent: (e: AssistantStreamEvent) => void,
      signal?: AbortSignal,
    ): Promise<void> {
      await new Promise((r) => setImmediate(r)); // yield, as the real stream does
      record.abortedAtFirstTick = signal?.aborted ?? false;
      onEvent({ type: 'text_delta', delta: 'Hello' });
      onEvent({ type: 'done' });
    },
  };
  // Only assistantStream is exercised by this route.
  return api as unknown as StreamingSloopApi;
}

let server: Server;
let baseUrl: string;
const record: { abortedAtFirstTick: boolean | null } = { abortedAtFirstTick: null };

beforeAll(async () => {
  const built = buildServer({ api: buildFakeApi(record), workspaceRoot: process.cwd() });
  server = built.server;
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://localhost:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

describe('POST /api/assistant/stream', () => {
  it('does not abort before the first agent iteration (req-close regression)', async () => {
    const res = await fetch(`${baseUrl}/api/assistant/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', text: 'say hi' }] }),
    });
    expect(res.status).toBe(200);
    const body = await res.text();

    expect(record.abortedAtFirstTick).toBe(false); // signal must be live when the agent starts
    expect(body).toContain('"type":"text_delta"'); // ...and the agent's text reaches the client
    expect(body).toContain('Hello');
    expect(body).toContain('"type":"done"');
  });

  it('rejects a body without a messages array (400)', async () => {
    const res = await fetch(`${baseUrl}/api/assistant/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nope: true }),
    });
    expect(res.status).toBe(400);
  });
});
