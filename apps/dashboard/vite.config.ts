import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ['@nudge/source'] },
  server: {
    // Le dashboard appelle `/api/…` sur sa propre origine : le cookie de session
    // reste first-party, sans CORS. Le déploiement (#18) devra servir le dashboard
    // et l'api sous une même origine de la même façon.
    proxy: { '/api': process.env.NUDGE_API_URL ?? 'http://localhost:3000' },
  },
});
