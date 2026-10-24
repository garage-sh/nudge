import { defineConfig, devices } from '@playwright/test';

/**
 * Tests navigateur du Widget, sur ses builds (`dist/`, produits par `yarn test:e2e`).
 * Aucun serveur : la page hôte, les scripts et l'API factice sont servis par
 * interception des requêtes (`e2e/hote.ts`).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
