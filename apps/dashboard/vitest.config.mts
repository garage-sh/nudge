import { defineConfig, mergeConfig } from 'vitest/config';
import { sourceResolution } from '../../vitest.shared.mts';

export default mergeConfig(
  sourceResolution,
  defineConfig({
    test: {
      name: '@nudge/dashboard',
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
    },
  }),
);
