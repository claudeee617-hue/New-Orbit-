import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The dashboard talks to the local ORBIT API through a same-origin /api proxy so the browser
// never needs CORS access to the API.
const apiTarget = process.env['ORBIT_API_URL'] ?? 'http://127.0.0.1:4317';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      // Keep the authenticated API's /api/v1 prefix intact. It must be matched
      // before the generic /api health-check proxy below.
      '/api/v1': {
        target: apiTarget,
        changeOrigin: false,
      },
      // The API health endpoint is intentionally public at /health.
      '/api': {
        target: apiTarget,
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
