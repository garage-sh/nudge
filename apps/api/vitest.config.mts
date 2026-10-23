import { defineConfig, mergeConfig } from 'vitest/config';
import { resolutionSources, swcNest } from '../../vitest.shared.mts';

export default mergeConfig(
  resolutionSources,
  defineConfig({ plugins: [swcNest()], test: { name: '@nudge/api' } }),
);
