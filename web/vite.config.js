import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy /api and /auth to the local Wrangler dev server (:8787) so the
// browser sees a single origin (:5173) — cookies set by the Worker
// (HttpOnly, SameSite=Lax) ride along on subsequent requests without
// any CORS-credentials gymnastics.
//
// In production the Worker serves the built `web/dist` directly, so
// these paths are same-origin without the proxy.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api':  { target: 'http://127.0.0.1:8787', changeOrigin: false },
      '/auth': { target: 'http://127.0.0.1:8787', changeOrigin: false },
    },
  },
});
