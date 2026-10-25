import { defineConfig, mergeConfig } from 'vitest/config';
import { sourceResolution } from '../../vitest.shared.mts';

// The React wrapper and the locales in jsdom; the Widget itself is tested in a browser (`yarn test:e2e`).
export default mergeConfig(
  sourceResolution,
  defineConfig({
    test: {
      name: '@nudge/widget',
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
    },
  }),
);
