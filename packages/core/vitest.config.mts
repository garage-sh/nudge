import { defineConfig, mergeConfig } from 'vitest/config';
import { resolutionSources } from '../../vitest.shared.mts';

export default mergeConfig(resolutionSources, defineConfig({ test: { name: '@nudge/core' } }));
