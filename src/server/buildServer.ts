// Assembles the sloop HTTP server: /api routes, the /api/files raw-workspace bridge,
// the cascade WebSocket stream, the error funnel, and (optionally) the static web UI.
// Returns a non-listening http.Server so both the env-driven entrypoint (main) and the
// programmatic CLI entry (startServer) share one definition.

import { createServer, type Server } from 'node:http';
import { promises as fs } from 'node:fs';
import { join, normalize, dirname, sep } from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import { WebSocketServer } from 'ws';
import { NotFound, Conflict, type StreamingSloopApi } from './api/real';
import type { CascadeStreamEvent } from './api/contract';
import { mountWebUi } from './webui';

export interface BuildServerOptions {
  api: StreamingSloopApi;
  /** Workspace root, for the raw /api/files bridge. */
  workspaceRoot: string;
  /** Built web UI dir; mounted if it contains index.html. */
  distDir?: string;
}

/** Build (but do not start) the HTTP server. Returns { server, uiMounted }. */
export function buildServer(opts: BuildServerOptions): { server: Server; uiMounted: boolean } {
  const { api, workspaceRoot, distDir } = opts;

  const safeWorkspacePath = (relPath: string): string => {
    const abs = normalize(join(workspaceRoot, relPath));
    if (abs !== workspaceRoot && !abs.startsWith(workspaceRoot + sep)) {
      throw new NotFound(`Path escapes the workspace: ${relPath}`);
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
  app.post('/api/adrs/:relPath/move', h(async (req, res) =>
    res.json(await api.moveAdr(decodeURIComponent(req.params.relPath), String(req.body?.to ?? ''))),
  ));

  app.get('/api/workflows', h(async (_req, res) => res.json(await api.listWorkflows())));
  app.get('/api/roles', h(async (_req, res) => res.json(await api.listRoles())));

  app.get('/api/files/:relPath', h(async (req, res) => {
    const rel = decodeURIComponent(req.params.relPath);
    try {
      res.json({ content: await fs.readFile(safeWorkspacePath(rel), 'utf8') });
    } catch {
      throw new NotFound(`File not found: ${rel}`);
    }
  }));
  app.put('/api/files/:relPath', h(async (req, res) => {
    const abs = safeWorkspacePath(decodeURIComponent(req.params.relPath));
    await fs.mkdir(dirname(abs), { recursive: true });
    await fs.writeFile(abs, String(req.body?.content ?? ''), 'utf8');
    res.json({ ok: true });
  }));

  app.get('/api/models', h(async (_req, res) => res.json(await api.listModels())));
  app.post('/api/assistant', h(async (req, res) => res.json(await api.assistant(req.body))));

  app.get('/api/cascades', h(async (_req, res) => res.json(await api.listCascades())));
  app.post('/api/cascades', h(async (req, res) => res.json(await api.createCascade(req.body))));
  app.get('/api/cascades/:id', h(async (req, res) => res.json(await api.getCascade(req.params.id))));
  app.post('/api/cascades/:id/approve', h(async (req, res) =>
    res.json(await api.approveCascade(req.params.id)),
  ));

  const uiMounted = distDir ? mountWebUi(app, distDir) : false;

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof NotFound) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof Conflict) {
      res.status(409).json({ error: err.message });
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
      const unsubscribe = api.subscribe(cascadeId, sendEvent, () => ws.close());
      ws.on('close', unsubscribe);
    });
  });

  return { server, uiMounted };
}
