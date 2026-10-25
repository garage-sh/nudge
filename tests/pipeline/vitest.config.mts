import { defineConfig, mergeConfig } from 'vitest/config';
import { sourceResolution, swcNest } from '../../vitest.shared.mts';

export default mergeConfig(
  sourceResolution,
  defineConfig({
    plugins: [swcNest()],
    test: {
      name: '@nudge/pipeline-tests',
      // One Postgres container and one Redis container for the whole suite;
      // each `startPipeline()` isolates itself in its own database and queue prefix.
      globalSetup: ['./src/harness/containers.ts'],
      testTimeout: 30_000,
      hookTimeout: 120_000,
    },
  }),
);
