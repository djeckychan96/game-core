import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'GameCore',
      formats: ['es', 'iife'],
      fileName: (format) => `game-core.${format === 'es' ? 'es' : 'iife'}.js`
    },
    rollupOptions: {
      external: ['pixi.js', 'pixi.js-legacy', '@pixi/core', '@pixi/display', '@pixi/sprite'],
      output: {
        globals: {
          'pixi.js': 'PIXI',
          'pixi.js-legacy': 'PIXI',
          '@pixi/core': 'PIXI',
          '@pixi/display': 'PIXI',
          '@pixi/sprite': 'PIXI'
        }
      }
    }
  },
  plugins: [
    dts({ rollupTypes: true })
  ],
  test: {
    environment: 'node'
  }
});
