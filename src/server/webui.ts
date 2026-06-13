// Static serving of the built React app (Vite output) with an SPA fallback. Mounted by
// buildServer alongside the /api routes on the same port. If the build is missing, this
// is a no-op so the API still serves (the caller logs a build hint).

import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';

/**
 * Serve `distDir` as static assets, falling back to index.html for client-side routes.
 * Returns true if mounted, false if `distDir` has no index.html (nothing mounted).
 */
export function mountWebUi(app: Express, distDir: string): boolean {
  const indexHtml = path.join(distDir, 'index.html');
  if (!existsSync(indexHtml)) return false;

  app.use(express.static(distDir));
  // SPA fallback: anything not handled by /api or a static asset returns index.html.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.sendFile(indexHtml);
  });
  return true;
}
