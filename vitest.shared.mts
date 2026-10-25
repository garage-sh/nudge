import swc from 'unplugin-swc';
import { defaultClientConditions, defaultServerConditions, type UserConfig } from 'vite';

/**
 * Shared base for the vitest projects: `@nudge/*` packages resolve to their
 * sources (`@nudge/source` condition), so no build is needed before tests.
 */
export const sourceResolution: UserConfig = {
  resolve: { conditions: ['@nudge/source', ...defaultClientConditions] },
  ssr: { resolve: { conditions: ['@nudge/source', ...defaultServerConditions] } },
};

/**
 * Nest relies on `emitDecoratorMetadata`, which esbuild cannot emit: projects
 * that load Nest code go through SWC.
 */
export const swcNest = () =>
  swc.vite({
    tsconfigFile: false,
    jsc: {
      target: 'es2022',
      parser: { syntax: 'typescript', decorators: true },
      transform: { legacyDecorator: true, decoratorMetadata: true, useDefineForClassFields: false },
    },
    module: { type: 'es6' },
  });
