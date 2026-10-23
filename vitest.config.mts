import { defineConfig } from 'vitest/config';

// Point d'entrée racine : `yarn vitest related --run <fichiers>` couvre tous les workspaces.
export default defineConfig({
  test: {
    projects: [
      'apps/*/vitest.config.mts',
      'packages/*/vitest.config.mts',
      'tests/*/vitest.config.mts',
    ],
  },
});
