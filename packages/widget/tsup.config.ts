import config from '@nudge/tsup-config';

export default [
  // npm : ESM et types, l'élément et le wrapper React (React reste chez l'hôte).
  config({
    entry: { index: 'src/index.ts', react: 'src/react.tsx' },
    format: ['esm'],
    external: ['react'],
    // Les deux builds tournent en parallèle dans `dist/` : aucun ne le vide.
    clean: false,
    shims: false,
  }),
  // Balise script : un seul fichier autonome, minifié, qui expose `window.Nudge`.
  config({
    entry: { 'nudge-widget': 'src/iife.ts' },
    format: ['iife'],
    globalName: 'Nudge',
    outExtension: () => ({ js: '.js' }),
    dts: false,
    clean: false,
    minify: true,
    shims: false,
  }),
];
