import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const rootDir = dirname(fileURLToPath(import.meta.url));

// Standalone GAME CORE UI SHOWCASE: a Vite app living inside the package, independent of any game.
// `npm run showcase -- --host 0.0.0.0` serves it on the LAN (open it on an iPhone).
// The showcase imports the kit through the same public entry names a game would use
// (`game-core` and `game-core/pixi`); in dev they resolve to src so edits hot-reload.
export default defineConfig({
  root: resolve(rootDir, 'examples/pixi-showcase'),
  publicDir: resolve(rootDir, 'assets'),
  base: './',
  resolve: {
    alias: [
      { find: 'game-core/pixi', replacement: resolve(rootDir, 'src/pixi/index.ts') },
      { find: 'game-core', replacement: resolve(rootDir, 'src/index.ts') }
    ]
  },
  define: {
    __GAME_CORE_BUILD_INFO__: JSON.stringify({ version: 'showcase', commit: 'dev', dirty: false, builtAt: '' })
  },
  server: {
    port: 5180,
    strictPort: false
  },
  build: {
    outDir: resolve(rootDir, 'dist-showcase'),
    emptyOutDir: true
  }
});
