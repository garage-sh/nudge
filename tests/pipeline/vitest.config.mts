import { defineConfig, mergeConfig } from 'vitest/config';
import { resolutionSources, swcNest } from '../../vitest.shared.mts';

export default mergeConfig(
  resolutionSources,
  defineConfig({
    plugins: [swcNest()],
    test: {
      name: '@nudge/pipeline-tests',
      // Un conteneur Postgres et un conteneur Redis pour toute la suite ;
      // chaque `demarrerPipeline()` s'isole dans sa propre base et son propre préfixe de queues.
      globalSetup: ['./src/harness/conteneurs.ts'],
      testTimeout: 30_000,
      hookTimeout: 120_000,
    },
  }),
);
