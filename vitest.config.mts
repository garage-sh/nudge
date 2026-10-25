import { defineConfig } from 'vitest/config';

// Root entry point: `yarn vitest related --run <files>` covers every workspace.
export default defineConfig({
  test: {
    projects: [
      'apps/*/vitest.config.mts',
      'packages/*/vitest.config.mts',
      'tests/*/vitest.config.mts',
    ],
  },
});
