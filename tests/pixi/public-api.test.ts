import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import './setup';
import * as pixiEntry from '../../src/pixi/index';
import * as rootEntry from '../../src/index';

const rootDir = resolve(__dirname, '../..');

describe('game-core/pixi public entry', () => {
  it('exports the Ready UI kit', () => {
    for (const name of [
      'LevelMapView', 'HudView', 'UiButton', 'ModalWindow', 'ResultWindowView', 'LivesWindowView', 'ShopWindowView',
      'loadReadyUiAssets', 'createReadyUiTextures', 'READY_UI_ASSET_FILES', 'READY_UI_FONT_FILE', 'READY_UI_FONT_FAMILY',
      'DEFAULT_READY_UI_THEME', 'ALT_READY_UI_THEME', 'UI_BUTTON_ROLES', 'resolveTheme', 'buttonStyleOf', 'UiPanel', 'UiSurface', 'drawSurface', 'drawPanel', 'drawCloseMark', 'toFillInput', 'createLabel', 'fitLabelWidth', 'applyTextResolution', 'formatAmount', 'formatTimer', 'backOut',
      'ClickRippleEffect', 'DEFAULT_CLICK_RIPPLE'
    ]) {
      expect(pixiEntry, name).toHaveProperty(name);
    }
  });

  it('keeps the root entry renderer-agnostic (no kit classes, no pixi.js)', () => {
    const rootKeys = Object.keys(rootEntry);
    for (const name of ['LevelMapView', 'HudView', 'ResultWindowView', 'UiButton', 'ClickRippleEffect']) {
      expect(rootKeys).not.toContain(name);
    }
    const rootSources = ['src/index.ts', 'src/ui/UiRuntime.ts', 'src/motion/MotionRuntime.ts', 'src/core/CoreRuntime.ts'];
    for (const file of rootSources) {
      expect(readFileSync(resolve(rootDir, file), 'utf-8')).not.toMatch(/from ['"]pixi\.js['"]/);
    }
  });

  it('the kit imports the foundation as types only (no core runtime duplicated in the pixi bundle)', () => {
    const kitFiles = ['LevelMapView.ts', 'HudView.ts', 'UiButton.ts', 'ModalWindow.ts', 'skin.ts', 'theme.ts', 'ResultWindowView.ts', 'LivesWindowView.ts', 'ShopWindowView.ts', 'fx/ClickRippleEffect.ts', 'fx/easing.ts'];
    for (const file of kitFiles) {
      const source = readFileSync(resolve(rootDir, 'src/pixi', file), 'utf-8');
      const foundationImports = source.match(/^import\s+(type\s+)?[^;]*from ['"](\.\.\/)+index['"];/gm) ?? [];
      for (const line of foundationImports) expect(line, `${file}: ${line}`).toMatch(/^import type/);
    }
  });

  it('is wired in package.json as a separate export with pixi.js as an optional peer', () => {
    const pkg = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf-8'));
    expect(pkg.exports['./pixi'].import).toBe('./dist/pixi/game-core-pixi.es.js');
    expect(pkg.exports['./pixi'].types).toMatch(/^\.\/dist\/pixi\/.*index\.d\.ts$/);
    expect(pkg.exports['.'].import).toBe('./dist/game-core.es.js');
    expect(pkg.peerDependencies['pixi.js']).toBeDefined();
    expect(pkg.peerDependenciesMeta['pixi.js'].optional).toBe(true);
    expect(pkg.files).toContain('assets');
  });

  it('ships every manifest asset and the font inside the package', () => {
    const assetsDir = resolve(rootDir, 'assets/pixi-ui');
    for (const [name, file] of Object.entries(pixiEntry.READY_UI_ASSET_FILES)) {
      expect(existsSync(resolve(assetsDir, file)), `${name} -> ${file}`).toBe(true);
    }
    expect(existsSync(resolve(assetsDir, pixiEntry.READY_UI_FONT_FILE))).toBe(true);
    expect(Object.keys(pixiEntry.createReadyUiTextures(pixiEntry.DEFAULT_READY_UI_THEME as never)).length).toBe(Object.keys(pixiEntry.READY_UI_ASSET_FILES).length);
  });

  it('formats counters and timers like the donor HUD', () => {
    expect(pixiEntry.formatAmount(12450)).toBe('12 450');
    expect(pixiEntry.formatAmount(999)).toBe('999');
    expect(pixiEntry.formatAmount(1000000)).toBe('1 000 000');
    expect(pixiEntry.formatTimer(17 * 60 + 42)).toBe('17:42');
    expect(pixiEntry.formatTimer(3600 + 5)).toBe('01:00:05');
    expect(pixiEntry.formatTimer(-3)).toBe('00:00');
  });

  it('resolveTheme merges one level deep over the defaults', () => {
    const theme = pixiEntry.resolveTheme({ text: { fontFamily: 'Custom' }, levelMap: { levelGap: 400 } });
    expect(theme.text.fontFamily).toBe('Custom');
    expect(theme.text.fill).toBe(pixiEntry.DEFAULT_READY_UI_THEME.text.fill);
    expect(theme.levelMap.levelGap).toBe(400);
    expect(theme.levelMap.nodeScale).toBe(pixiEntry.DEFAULT_READY_UI_THEME.levelMap.nodeScale);
    expect(pixiEntry.resolveTheme()).toBe(pixiEntry.DEFAULT_READY_UI_THEME);
  });
});
