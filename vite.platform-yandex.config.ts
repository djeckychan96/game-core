import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

const rootDir = dirname(fileURLToPath(import.meta.url));

// Third public entry: `game-core/platform/yandex` — the production Yandex Games platform adapter.
// Built separately from the root bundle, like `game-core/pixi`: `import "game-core"` never pulls a
// platform SDK in, and only a Yandex build of a game imports this. The adapter knows the root as
// types only, so no root runtime code is duplicated here and there is nothing to mark external.
export default defineConfig({
  build: {
    outDir: resolve(rootDir, 'dist/platform/yandex'),
    emptyOutDir: true,
    lib: {
      entry: resolve(rootDir, 'src/platform/adapters/yandex/index.ts'),
      formats: ['es'],
      fileName: () => 'game-core-platform-yandex.es.js'
    }
  },
  plugins: [
    // Declarations as a tree rooted at src (the entry is dist/platform/yandex/platform/adapters/yandex/index.d.ts,
    // its type-only imports — the capability contract, PaymentsAdapter — ship next to it), same reason as the kit.
    dts({
      rollupTypes: false,
      entryRoot: resolve(rootDir, 'src'),
      include: ['src/platform', 'src/purchases/types.ts'],
      outDir: resolve(rootDir, 'dist/platform/yandex')
    })
  ]
});
