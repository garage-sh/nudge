import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ['@nudge/source'] },
  server: {
    // Le dashboard appelle `/api/…` sur sa propre origine : le cookie de session
    // reste first-party, sans CORS. En production, le conteneur du dashboard relaie
    // `/api` de la même façon (apps/dashboard/nginx/default.conf.template).
    proxy: { '/api': process.env.NUDGE_API_URL ?? 'http://localhost:3000' },
  },
});
