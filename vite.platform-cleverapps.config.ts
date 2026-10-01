import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

const rootDir = dirname(fileURLToPath(import.meta.url));

// Public entry `game-core/platform/cleverapps`: a structural adapter only. The Facebook host ships
// a locally pinned connector.latest.js and initializes it; the vendor script is never an input.
export default defineConfig({
  build: {
    outDir: resolve(rootDir, 'dist/platform/cleverapps'),
    emptyOutDir: true,
    lib: {
      entry: resolve(rootDir, 'src/platform/adapters/cleverapps/index.ts'),
      formats: ['es'],
      fileName: () => 'game-core-platform-cleverapps.es.js'
    }
  },
  plugins: [
    dts({
      rollupTypes: false,
      entryRoot: resolve(rootDir, 'src'),
      include: [
        'src/platform/adapters/cleverapps',
        'src/platform/support/adWatchdog.ts',
        'src/platform/support/withTimeout.ts',
        'src/platform/types.ts',
        'src/purchases/types.ts'
      ],
      outDir: resolve(rootDir, 'dist/platform/cleverapps')
    })
  ]
});
