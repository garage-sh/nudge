import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import config from '@nudge/tsup-config';
import type { Plugin } from 'esbuild';

/**
 * Resolves `html-to-image` the way Node does (its ESM build, `module`): esbuild switches
 * to Yarn PnP resolution as soon as it finds a `.pnp.cjs` in a parent directory, even
 * outside the repo, and would then not find the package bundled into the IIFE build.
 */
const nodeResolution: Plugin = {
  name: 'node-resolution',
  setup(build) {
    const require = createRequire(import.meta.url);
    build.onResolve({ filter: /^html-to-image$/ }, () => ({
      path: join(dirname(require.resolve('html-to-image/package.json')), 'es/index.js'),
    }));
  },
};

export default [
  // npm: ESM and types, the element and the React wrapper (React stays with the host).
  config({
    entry: { index: 'src/index.ts', react: 'src/react.tsx' },
    format: ['esm'],
    external: ['react'],
    // The Capture renderer is bundled: the build has no runtime dependency.
    noExternal: ['html-to-image'],
    esbuildPlugins: [nodeResolution],
    // Both builds run in parallel into `dist/`: neither cleans it.
    clean: false,
    shims: false,
  }),
  // Script tag: a single self-contained, minified file that exposes `window.Nudge`.
  config({
    entry: { 'nudge-widget': 'src/iife.ts' },
    format: ['iife'],
    noExternal: ['html-to-image'],
    esbuildPlugins: [nodeResolution],
    globalName: 'Nudge',
    outExtension: () => ({ js: '.js' }),
    dts: false,
    clean: false,
    minify: true,
    shims: false,
  }),
];
