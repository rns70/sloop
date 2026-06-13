import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The web app talks ONLY to the backend HTTP/WS API under /api.
// In dev, Vite serves the React app on PORT_WEB and proxies /api to the
// Node server (default 5174), including WebSocket upgrades for the cascade stream.
const SERVER_PORT = process.env.PORT ?? '5174';
const WEB_PORT = Number(process.env.PORT_WEB ?? '5173');

export default defineConfig({
  plugins: [react()],
  root: 'src/web',
  publicDir: false,
  server: {
    port: WEB_PORT,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://localhost:${SERVER_PORT}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
  },
});
