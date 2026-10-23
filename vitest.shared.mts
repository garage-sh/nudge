import swc from 'unplugin-swc';
import { defaultClientConditions, defaultServerConditions, type UserConfig } from 'vite';

/**
 * Base commune des projets vitest : les packages `@nudge/*` sont résolus sur
 * leurs sources (condition `@nudge/source`), donc aucun build n'est requis
 * avant les tests.
 */
export const resolutionSources: UserConfig = {
  resolve: { conditions: ['@nudge/source', ...defaultClientConditions] },
  ssr: { resolve: { conditions: ['@nudge/source', ...defaultServerConditions] } },
};

/**
 * Nest repose sur `emitDecoratorMetadata`, qu'esbuild ne sait pas émettre :
 * les projets qui chargent du code Nest passent par SWC.
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
