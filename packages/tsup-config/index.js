const { defineConfig } = require('tsup');

/** Configuration tsup commune aux packages : CJS (.js) + ESM (.mjs) + types. */
module.exports = (options = {}) =>
  defineConfig({
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: { compilerOptions: { customConditions: [] } },
    outDir: 'dist',
    clean: true,
    sourcemap: true,
    shims: true,
    ...options,
  });
