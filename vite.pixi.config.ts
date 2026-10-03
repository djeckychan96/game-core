import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

const rootDir = dirname(fileURLToPath(import.meta.url));
const slash = (path: string): string => path.replace(/\\/g, '/');

/** Where the kit's declaration tree, the tree's copy of the root entry and the root entry's own declarations live. */
export interface KitDeclarationDirs {
  /** dist/pixi/pixi — the kit (src/pixi). */
  kit: string;
  /** dist/pixi/index — where src/index.ts would land in this tree (no extension). */
  treeRoot: string;
  /** dist/index — the root entry's rolled-up declarations, what `game-core` resolves to (no extension). */
  root: string;
}

const KIT_DECLARATION_DIRS: KitDeclarationDirs = {
  kit: slash(resolve(rootDir, 'dist/pixi/pixi')),
  treeRoot: slash(resolve(rootDir, 'dist/pixi/index')),
  root: slash(resolve(rootDir, 'dist/index'))
};

/**
 * The kit's declarations name the ROOT entry's types, never a copy of them. The kit's sources reach the foundation only
 * through the root entry (`import type { MotionRuntime, UiRuntime … } from '../index'`, i.e. src/index.ts); emitted as
 * a tree, that import landed on a second set of the root's declarations (dist/pixi/index.d.ts, dist/pixi/motion/… ),
 * and a class with private members declared twice is two types to TypeScript — a host's `new MotionRuntime()` from
 * `game-core` was not assignable to the kit's `ModalWindowOptions['motion']` without a cast. So every import of the
 * root entry is pointed at dist/index.d.ts (the declarations `game-core` resolves to), no declaration outside the kit
 * is written, and any other import leaving the kit fails the build. Returns what vite-plugin-dts' `beforeWriteFile`
 * expects: `false` = skip the file.
 */
export function kitDeclaration(filePath: string, content: string, dirs: KitDeclarationDirs = KIT_DECLARATION_DIRS): false | { content: string } {
  const file = slash(filePath);
  if (!file.startsWith(`${dirs.kit}/`)) return false;
  if (!file.endsWith('.d.ts')) return { content };
  const from = posix.dirname(file);
  const rewritten = content.replace(/(\bfrom\s*|\bimport\s*\(\s*)(['"])(\.\.?\/[^'"]*)\2/g, (match, head: string, quote: string, specifier: string) => {
    const target = posix.resolve(from, specifier);
    if (target.startsWith(`${dirs.kit}/`)) return match;
    if (target !== dirs.treeRoot) {
      throw new Error(`vite.pixi.config: ${posix.relative(dirs.kit, file)} imports '${specifier}' — the kit may reach code outside src/pixi only through the root entry (src/index.ts)`);
    }
    const toRoot = posix.relative(from, dirs.root);
    return `${head}${quote}${toRoot.startsWith('.') ? toRoot : `./${toRoot}`}${quote}`;
  });
  return { content: rewritten };
}

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
    // Declarations are emitted as a tree rooted at src (dist/pixi/pixi/index.d.ts is the entry); only the kit's part
    // of it is written, its root-entry imports pointing at dist/index.d.ts (kitDeclaration above), so `game-core` and
    // `game-core/pixi` share one declaration of every foundation type. vite-plugin-dts's single-file rollup silently
    // drops an entry whose type imports live outside its entryRoot, hence no rollupTypes.
    dts({
      rollupTypes: false,
      entryRoot: resolve(rootDir, 'src'),
      include: ['src'],
      outDir: resolve(rootDir, 'dist/pixi'),
      beforeWriteFile: (filePath, content) => kitDeclaration(filePath, content)
    })
  ]
});
