import { defineConfig, mergeConfig } from 'vitest/config';
import { resolutionSources } from '../../vitest.shared.mts';

// Le wrapper React en jsdom ; le Widget lui-même est testé en navigateur (`yarn test:e2e`).
export default mergeConfig(
  resolutionSources,
  defineConfig({
    test: {
      name: '@nudge/widget',
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
    },
  }),
);
