// sloop backend entrypoint. Mounts the API over Express plus a WebSocket server for
// the cascade live stream. Port via PORT (5174); workspace via SLOOP_WORKSPACE.
//
// Mock vs real (the WP-6 swap point):
//   SLOOP_MOCK=1 (truthy) → WP-0's in-memory MockApi — a guaranteed, network-free
//                           demo fallback that serves the full UI from fixture data.
//   unset                 → the real backend (FilesService/GitService/CascadeEngine/
//                           Executor + WP-7 author), wired to genuine services.
// Both satisfy the same `SloopApi` contract, so the HTTP routes below are identical;
// only the construction and the WS stream source differ.

import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import { resolve, join, normalize, dirname, sep } from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import { WebSocketServer } from 'ws';
import { MockApi, NotFound as MockNotFound } from './api/mock';
import { createRealApi, NotFound as RealNotFound, type StreamingSloopApi } from './api/real';
import type { SloopApi, CascadeStreamEvent } from './api/contract';

const PORT = Number(process.env.PORT ?? 5174);
const WORKSPACE = resolve(process.env.SLOOP_WORKSPACE ?? 'fixtures/sample-workspace');

/** Truthy SLOOP_MOCK selects the mock backend (0/false/no/off = real). */
function useMock(env: NodeJS.ProcessEnv): boolean {
  const raw = env.SLOOP_MOCK;
  if (!raw) return false;
  const v = raw.toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'no' && v !== 'off';
}

/** Both backends throw their own NotFound; treat either as a 404. */
function isNotFound(err: unknown): boolean {
  return err instanceof MockNotFound || err instanceof RealNotFound;
}

/** Live WS push is only available on the real backend (feature-detected). */
function isStreaming(api: SloopApi): api is StreamingSloopApi {
  return typeof (api as Partial<StreamingSloopApi>).subscribe === 'function';
}

async function main(): Promise<void> {
  const mock = useMock(process.env);
  const api: SloopApi = mock ? new MockApi(WORKSPACE) : await createRealApi(WORKSPACE, process.env);

  const app = express();
  app.use(express.json({ limit: '4mb' }));

  // Small async wrapper so handler rejections become 404/500 instead of unhandled.
  const h =
    (fn: (req: Request, res: Response) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) => {
      fn(req, res).catch(next);
    };

  app.get('/api/health', (_req, res) =>
    res.json({ ok: true, workspace: WORKSPACE, backend: mock ? 'mock' : 'real' }),
  );

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

  // Raw workspace markdown (role/template/config files). Per the canonical API table;
  // backed directly by the workspace filesystem so it works in both mock and real mode.
  app.get('/api/files/:relPath', h(async (req, res) =>
    res.json({ content: await readWorkspaceFile(decodeURIComponent(req.params.relPath)) }),
  ));
  app.put('/api/files/:relPath', h(async (req, res) => {
    await writeWorkspaceFile(decodeURIComponent(req.params.relPath), String(req.body?.content ?? ''));
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

  // Error funnel: missing resources -> 404, everything else -> 500 with a message.
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

  // WS: /api/cascades/:id/stream.
  //   real → subscribe to live engine events (loop-update + output), replaying any
  //          buffered so far so a late subscriber catches up; closed when the run ends.
  //   mock → replay the scripted event sequence with pacing so the view animates.
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
      const sendEvent = (event: CascadeStreamEvent) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
      };

      if (isStreaming(api)) {
        const unsubscribe = api.subscribe(cascadeId, sendEvent, () => ws.close());
        ws.on('close', unsubscribe);
        return;
      }

      // Mock: replay the scripted sequence, then close.
      void (async () => {
        try {
          const events = await api.streamEvents(cascadeId);
          for (const event of events) {
            if (ws.readyState !== ws.OPEN) break;
            sendEvent(event);
            // Small pacing so the live view animates rather than dumping instantly.
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

  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(
      `sloop server (${mock ? 'mock' : 'real'}) on http://localhost:${PORT}  workspace=${WORKSPACE}`,
    );
  });
}

// ---- workspace raw-file access (for /api/files) ----------------------------

/** Resolve a workspace-relative path, rejecting traversal outside the root. */
function safeWorkspacePath(relPath: string): string {
  const abs = normalize(join(WORKSPACE, relPath));
  if (abs !== WORKSPACE && !abs.startsWith(WORKSPACE + sep)) {
    throw new RealNotFound(`Path escapes the workspace: ${relPath}`);
  }
  return abs;
}

async function readWorkspaceFile(relPath: string): Promise<string> {
  try {
    return await fs.readFile(safeWorkspacePath(relPath), 'utf8');
  } catch {
    throw new RealNotFound(`File not found: ${relPath}`);
  }
}

async function writeWorkspaceFile(relPath: string, content: string): Promise<void> {
  const abs = safeWorkspacePath(relPath);
  await fs.mkdir(dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[sloop] failed to start:', err);
  process.exit(1);
});
