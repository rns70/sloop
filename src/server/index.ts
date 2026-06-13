// sloop backend entrypoint. Mounts the API (mock for WP-0; real for WP-6) over
// Express, plus a WebSocket server for the cascade live stream. Port via PORT (5174).
//
// WP-6 swaps `new MockApi(...)` for real services wired to the same SloopApi contract;
// the HTTP/WS plumbing below stays unchanged.

import { createServer } from 'node:http';
import { resolve } from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import { WebSocketServer } from 'ws';
import { MockApi, NotFound } from './api/mock';
import type { SloopApi } from './api/contract';

const PORT = Number(process.env.PORT ?? 5174);
const WORKSPACE = resolve(process.env.SLOOP_WORKSPACE ?? 'fixtures/sample-workspace');

const api: SloopApi = new MockApi(WORKSPACE);

const app = express();
app.use(express.json({ limit: '4mb' }));

// Small async wrapper so handler rejections become 404/500 instead of unhandled.
const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

app.get('/api/health', (_req, res) => res.json({ ok: true, workspace: WORKSPACE }));

app.get('/api/adrs', h(async (_req, res) => res.json(await api.listAdrs())));
app.get('/api/adrs/:relPath/diff', h(async (req, res) =>
  res.json(await api.getAdrDiff(decodeURIComponent(req.params.relPath))),
));
app.get('/api/adrs/:relPath', h(async (req, res) =>
  res.json(await api.getAdr(decodeURIComponent(req.params.relPath))),
));
app.put('/api/adrs/:relPath', h(async (req, res) =>
  res.json(await api.putAdr(decodeURIComponent(req.params.relPath), req.body)),
));

app.get('/api/templates', h(async (_req, res) => res.json(await api.listTemplates())));
app.get('/api/roles', h(async (_req, res) => res.json(await api.listRoles())));

app.post('/api/author', h(async (req, res) => res.json(await api.author(req.body))));

app.post('/api/cascades', h(async (req, res) => res.json(await api.createCascade(req.body))));
app.get('/api/cascades/:id', h(async (req, res) => res.json(await api.getCascade(req.params.id))));
app.post('/api/cascades/:id/approve', h(async (req, res) =>
  res.json(await api.approveCascade(req.params.id)),
));

// Error funnel: missing resources -> 404, everything else -> 500 with a message.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof NotFound) {
    res.status(404).json({ error: err.message });
    return;
  }
  // eslint-disable-next-line no-console
  console.error('[api] unhandled error:', err);
  res.status(500).json({ error: err instanceof Error ? err.message : 'internal error' });
});

const server = createServer(app);

// WS: /api/cascades/:id/stream — replay the (mock) scripted event sequence on connect.
const STREAM_RE = /^\/api\/cascades\/([^/]+)\/stream$/;
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url ?? '', `http://localhost:${PORT}`);
  const match = STREAM_RE.exec(pathname);
  if (!match) {
    socket.destroy();
    return;
  }
  const cascadeId = decodeURIComponent(match[1]);
  wss.handleUpgrade(req, socket, head, (ws) => {
    void (async () => {
      try {
        const events = await api.streamEvents(cascadeId);
        for (const event of events) {
          if (ws.readyState !== ws.OPEN) break;
          ws.send(JSON.stringify(event));
          // Small pacing so the live view animates rather than dumping instantly.
          await new Promise((r) => setTimeout(r, 350));
        }
      } catch (err) {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'output', loopId: cascadeId, chunk: `error: ${String(err)}\n` }));
        }
      } finally {
        ws.close();
      }
    })();
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`sloop server (mock) on http://localhost:${PORT}  workspace=${WORKSPACE}`);
});
