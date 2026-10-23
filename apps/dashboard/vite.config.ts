import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ['@nudge/source'] },
  server: {
    // Le dashboard appelle `/api/…` sur sa propre origine : le cookie de session
    // reste first-party, sans CORS. En production, le proxy du dashboard fait de même.
    proxy: { '/api': process.env.NUDGE_API_URL ?? 'http://localhost:3000' },
  },
});
