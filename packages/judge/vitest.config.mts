import { defineConfig, mergeConfig } from 'vitest/config';
import { sourceResolution } from '../../vitest.shared.mts';

export default mergeConfig(sourceResolution, defineConfig({ test: { name: '@nudge/judge' } }));
