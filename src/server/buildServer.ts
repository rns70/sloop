// Assembles the sloop HTTP server: /api routes, the /api/files raw-workspace bridge,
// the cascade WebSocket stream, the error funnel, and (optionally) the static web UI.
// Returns a non-listening http.Server so both the env-driven entrypoint (main) and the
// programmatic CLI entry (startServer) share one definition.

import { createServer, type Server } from 'node:http';
import { promises as fs } from 'node:fs';
import { join, normalize, dirname, sep } from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import { WebSocketServer } from 'ws';
import { NotFound as MockNotFound } from './api/mock';
import { NotFound as RealNotFound, type StreamingSloopApi } from './api/real';
import type { SloopApi, CascadeStreamEvent } from './api/contract';
import { mountWebUi } from './webui';

export interface BuildServerOptions {
  api: SloopApi;
  /** Workspace root, for the raw /api/files bridge. */
  workspaceRoot: string;
  /** Built web UI dir; mounted if it contains index.html. */
  distDir?: string;
}

function isNotFound(err: unknown): boolean {
  return err instanceof MockNotFound || err instanceof RealNotFound;
}

function isStreaming(api: SloopApi): api is StreamingSloopApi {
  return typeof (api as Partial<StreamingSloopApi>).subscribe === 'function';
}

/** Build (but do not start) the HTTP server. Returns { server, uiMounted }. */
export function buildServer(opts: BuildServerOptions): { server: Server; uiMounted: boolean } {
  const { api, workspaceRoot, distDir } = opts;

  const safeWorkspacePath = (relPath: string): string => {
    const abs = normalize(join(workspaceRoot, relPath));
    if (abs !== workspaceRoot && !abs.startsWith(workspaceRoot + sep)) {
      throw new RealNotFound(`Path escapes the workspace: ${relPath}`);
    }
    return abs;
  };

  const app = express();
  app.use(express.json({ limit: '4mb' }));

  const h =
    (fn: (req: Request, res: Response) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) => {
      fn(req, res).catch(next);
    };

  app.get('/api/health', (_req, res) => res.json({ ok: true, workspace: workspaceRoot }));

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

  app.get('/api/files/:relPath', h(async (req, res) => {
    const rel = decodeURIComponent(req.params.relPath);
    try {
      res.json({ content: await fs.readFile(safeWorkspacePath(rel), 'utf8') });
    } catch {
      throw new RealNotFound(`File not found: ${rel}`);
    }
  }));
  app.put('/api/files/:relPath', h(async (req, res) => {
    const abs = safeWorkspacePath(decodeURIComponent(req.params.relPath));
    await fs.mkdir(dirname(abs), { recursive: true });
    await fs.writeFile(abs, String(req.body?.content ?? ''), 'utf8');
    res.json({ ok: true });
  }));

  app.get('/api/models', h(async (_req, res) => res.json(await api.listModels())));
  app.post('/api/assistant/stream', (req, res) => {
    if (!req.body || !Array.isArray(req.body.messages)) {
      res.status(400).json({ error: 'assistant: request body must include a messages array' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // X-Accel-Buffering: disable proxy (nginx) buffering so tokens flush immediately
    });
    res.flushHeaders();
    const ac = new AbortController();
    req.on('close', () => ac.abort());
    api.assistantStream(req.body, (e) => {
      res.write(`data: ${JSON.stringify(e)}\n\n`);
    }, ac.signal).catch((err: unknown) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: err instanceof Error ? err.message : 'internal error' })}\n\n`);
      }
    }).finally(() => res.end());
  });

  app.get('/api/cascades', h(async (_req, res) => res.json(await api.listCascades())));
  app.post('/api/cascades', h(async (req, res) => res.json(await api.createCascade(req.body))));
  app.get('/api/cascades/:id', h(async (req, res) => res.json(await api.getCascade(req.params.id))));
  app.post('/api/cascades/:id/approve', h(async (req, res) =>
    res.json(await api.approveCascade(req.params.id)),
  ));

  const uiMounted = distDir ? mountWebUi(app, distDir) : false;

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (isNotFound(err)) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'not found' });
      return;
    }
    // eslint-disable-next-line no-console
    console.error('[api] unhandled error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'internal error' });
  });

  const server = createServer(app);

  const STREAM_RE = /^\/api\/cascades\/([^/]+)\/stream$/;
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '', 'http://localhost');
    const match = STREAM_RE.exec(pathname);
    if (!match) {
      socket.destroy();
      return;
    }
    const cascadeId = decodeURIComponent(match[1]);
    wss.handleUpgrade(req, socket, head, (ws) => {
      const sendEvent = (event: CascadeStreamEvent) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
      };
      if (isStreaming(api)) {
        const unsubscribe = api.subscribe(cascadeId, sendEvent, () => ws.close());
        ws.on('close', unsubscribe);
        return;
      }
      void (async () => {
        try {
          const events = await api.streamEvents(cascadeId);
          for (const event of events) {
            if (ws.readyState !== ws.OPEN) break;
            sendEvent(event);
            await new Promise((r) => setTimeout(r, 350));
          }
        } catch (err) {
          sendEvent({ type: 'output', loopId: cascadeId, chunk: `error: ${String(err)}\n` });
        } finally {
          ws.close();
        }
      })();
    });
  });

  return { server, uiMounted };
}
