import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import rootConfig from './vite.config';

const rootDir = dirname(fileURLToPath(import.meta.url));

// Fourth public entry: `game-core/qa` — the QA Panel + machine API of a QA BUILD. Built separately so that
// neither `game-core` nor `game-core/pixi` ever contains it: a production build of a game that does not
// import this entry has no QA code at all (scripts/check-qa-build.mjs + npm run qa:isolation). It knows the
// root as types only; the one value it shares is the build info, defined exactly as the root build does.
export default defineConfig({
  define: rootConfig.define ?? {},
  build: {
    outDir: resolve(rootDir, 'dist/qa'),
    emptyOutDir: true,
    lib: {
      entry: resolve(rootDir, 'src/qa/index.ts'),
      formats: ['es'],
      fileName: () => 'game-core-qa.es.js'
    }
  },
  plugins: [
    dts({
      rollupTypes: false,
      entryRoot: resolve(rootDir, 'src'),
      include: ['src/qa', 'src/buildInfo.ts', 'src/save', 'src/economy', 'src/lives', 'src/continue', 'src/platform/types.ts', 'src/purchases/types.ts', 'src/production'],
      outDir: resolve(rootDir, 'dist/qa')
    })
  ]
});
