import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { kitDeclaration, type KitDeclarationDirs } from '../../vite.pixi.config';

// One type identity across `game-core` and `game-core/pixi`: the kit's declarations name the root entry's own
// MotionRuntime / UiRuntime …, never a second copy. The built package itself is proven after `npm run build` by
// scripts/check-pixi-types.mjs (tests/types/pixi-consumer.ts compiles against dist with no cast); these pin the two
// rules that build relies on.

const rootDir = resolve(__dirname, '../..');
const kitDir = resolve(rootDir, 'src/pixi');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? sources(path) : entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('package type identity — game-core and game-core/pixi share one declaration of every foundation type', () => {
  it('the kit reaches code outside src/pixi only through the root entry (src/index.ts)', () => {
    const escapes: string[] = [];
    let rootImports = 0;
    for (const file of sources(kitDir)) {
      for (const match of readFileSync(file, 'utf-8').matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"](\.\.?\/[^'"]*)['"]/g)) {
        const target = resolve(dirname(file), match[1] as string);
        if (target.startsWith(`${kitDir}/`)) continue;
        if (target === resolve(rootDir, 'src/index')) rootImports++;
        else escapes.push(`${relative(rootDir, file)} → ${match[1]}`);
      }
    }
    expect(escapes).toEqual([]);
    expect(rootImports).toBeGreaterThan(0);
  });

  const dirs: KitDeclarationDirs = { kit: '/pkg/dist/pixi/pixi', treeRoot: '/pkg/dist/pixi/index', root: '/pkg/dist/index' };

  it('kit declarations import the root entry\'s dist/index.d.ts at any depth; kit-local imports stay as they are', () => {
    const modal = "import { Container } from 'pixi.js';\nimport { MotionRuntime, UiRuntime } from '../index';\nimport { UiButton } from './UiButton';\n";
    expect(kitDeclaration('/pkg/dist/pixi/pixi/ModalWindow.d.ts', modal, dirs)).toEqual({
      content: "import { Container } from 'pixi.js';\nimport { MotionRuntime, UiRuntime } from '../../index';\nimport { UiButton } from './UiButton';\n"
    });
    const ripple = 'import { EaseFn } from "../../index";\nexport type Ease = import("../../index").EaseName;\nimport { x } from "../theme";\n';
    expect(kitDeclaration('/pkg/dist/pixi/pixi/fx/ClickRippleEffect.d.ts', ripple, dirs)).toEqual({
      content: 'import { EaseFn } from "../../../index";\nexport type Ease = import("../../../index").EaseName;\nimport { x } from "../theme";\n'
    });
  });

  it('declarations outside the kit (the root\'s copy) are not written; kit maps pass unchanged', () => {
    expect(kitDeclaration('/pkg/dist/pixi/index.d.ts', 'export {};', dirs)).toBe(false);
    expect(kitDeclaration('/pkg/dist/pixi/motion/MotionRuntime.d.ts', 'export declare class MotionRuntime {}', dirs)).toBe(false);
    expect(kitDeclaration('/pkg/dist/pixi/pixi/ModalWindow.d.ts.map', '{"sources":["../../../src/pixi/ModalWindow.ts"]}', dirs))
      .toEqual({ content: '{"sources":["../../../src/pixi/ModalWindow.ts"]}' });
  });

  it('any other import leaving the kit fails the build (it would name a copy of a root type)', () => {
    expect(() => kitDeclaration('/pkg/dist/pixi/pixi/HudView.d.ts', "import { MotionRuntime } from '../motion/MotionRuntime';", dirs))
      .toThrow("vite.pixi.config: HudView.d.ts imports '../motion/MotionRuntime' — the kit may reach code outside src/pixi only through the root entry (src/index.ts)");
  });
});
