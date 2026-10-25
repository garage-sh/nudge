import { defineConfig, mergeConfig } from 'vitest/config';
import { sourceResolution, swcNest } from '../../vitest.shared.mts';

export default mergeConfig(
  sourceResolution,
  defineConfig({ plugins: [swcNest()], test: { name: '@nudge/worker' } }),
);
