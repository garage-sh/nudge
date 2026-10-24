import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import config from '@nudge/tsup-config';
import type { Plugin } from 'esbuild';

/**
 * Résout `html-to-image` comme Node (son build ESM, `module`) : esbuild bascule en
 * résolution Yarn PnP dès qu'il trouve un `.pnp.cjs` dans un dossier parent, même hors
 * du dépôt, et ne trouverait alors pas le paquet embarqué dans le build IIFE.
 */
const resolutionNode: Plugin = {
  name: 'resolution-node',
  setup(build) {
    const require = createRequire(import.meta.url);
    build.onResolve({ filter: /^html-to-image$/ }, () => ({
      path: join(dirname(require.resolve('html-to-image/package.json')), 'es/index.js'),
    }));
  },
};

export default [
  // npm : ESM et types, l'élément et le wrapper React (React reste chez l'hôte).
  config({
    entry: { index: 'src/index.ts', react: 'src/react.tsx' },
    format: ['esm'],
    external: ['react'],
    // Le rendu de la Capture est embarqué : le build reste sans dépendance d'exécution.
    noExternal: ['html-to-image'],
    esbuildPlugins: [resolutionNode],
    // Les deux builds tournent en parallèle dans `dist/` : aucun ne le vide.
    clean: false,
    shims: false,
  }),
  // Balise script : un seul fichier autonome, minifié, qui expose `window.Nudge`.
  config({
    entry: { 'nudge-widget': 'src/iife.ts' },
    format: ['iife'],
    noExternal: ['html-to-image'],
    esbuildPlugins: [resolutionNode],
    globalName: 'Nudge',
    outExtension: () => ({ js: '.js' }),
    dts: false,
    clean: false,
    minify: true,
    shims: false,
  }),
];
