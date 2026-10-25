import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ['@nudge/source'] },
  server: {
    // The dashboard calls `/api/…` on its own origin: the session cookie stays
    // first-party, without CORS. In production, the dashboard container relays `/api`
    // the same way (apps/dashboard/nginx/default.conf.template).
    proxy: { '/api': process.env.NUDGE_API_URL ?? 'http://localhost:3000' },
  },
});
