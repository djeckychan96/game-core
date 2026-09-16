import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

const rootDir = dirname(fileURLToPath(import.meta.url));

// Second public entry: `game-core/pixi` — the Pixi Ready UI kit. Built separately from the
// renderer-agnostic root bundle so that `import "game-core"` never pulls PixiJS in, and so that
// this bundle never pulls PixiJS in either: pixi.js stays an external peer dependency supplied by
// the host game. The kit imports the core only as types, so no core runtime code is duplicated.
export default defineConfig({
  build: {
    outDir: resolve(rootDir, 'dist/pixi'),
    emptyOutDir: true,
    lib: {
      entry: resolve(rootDir, 'src/pixi/index.ts'),
      formats: ['es'],
      fileName: () => 'game-core-pixi.es.js'
    },
    rollupOptions: {
      external: ['pixi.js'],
      output: {
        globals: { 'pixi.js': 'PIXI' }
      }
    }
  },
  plugins: [
    // Declarations are emitted as a tree rooted at src (dist/pixi/pixi/index.d.ts is the entry,
    // dist/pixi/ui/types.d.ts etc. are the type-only foundation imports it needs), so the
    // published types under dist/pixi are self-contained. vite-plugin-dts's single-file rollup
    // silently drops an entry whose type imports live outside its entryRoot, hence no rollupTypes.
    dts({
      rollupTypes: false,
      entryRoot: resolve(rootDir, 'src'),
      include: ['src'],
      outDir: resolve(rootDir, 'dist/pixi')
    })
  ]
});
