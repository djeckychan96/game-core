import { describe, expect, it, vi } from 'vitest';
import { Assets, Texture, TextureSource } from 'pixi.js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import './setup';
import * as pixiEntry from '../../src/pixi/index';
import * as rootEntry from '../../src/index';

const rootDir = resolve(__dirname, '../..');

describe('game-core/pixi public entry', () => {
  it('exports the Ready UI kit', () => {
    for (const name of [
      'LevelMapView', 'HudView', 'UiButton', 'ModalWindow', 'ResultWindowView', 'LivesWindowView', 'ShopWindowView', 'ConfirmWindowView',
      'loadReadyUiAssets', 'createReadyUiTextures', 'READY_UI_ASSET_FILES', 'READY_UI_FONT_FILE', 'READY_UI_FONT_FAMILY',
      'READY_UI_OPTIONAL_ASSET_FILES', 'READY_UI_NINE_SLICES', 'createNineSlice', 'CONFIRM_EXIT_FIGMA_TEXTURES', 'WIN_CONFETTI_TEXTURES', 'LIVES_FIGMA_TEXTURES',
      'READY_UI_CATALOGS',
      'DEFAULT_READY_UI_THEME', 'resolveTheme', 'createLabel', 'fitLabelWidth', 'applyTextResolution', 'formatAmount', 'formatTimer', 'backOut',
      'ClickRippleEffect', 'DEFAULT_CLICK_RIPPLE'
    ]) {
      expect(pixiEntry, name).toHaveProperty(name);
    }
    // the WIN confetti effect is internal to ResultWindowView (opt-in `confetti`), not a public class yet
    expect(Object.keys(pixiEntry)).not.toContain('WinConfettiEffect');
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
    const kitFiles = ['LevelMapView.ts', 'HudView.ts', 'UiButton.ts', 'ModalWindow.ts', 'ResultWindowView.ts', 'LivesWindowView.ts', 'ShopWindowView.ts', 'fx/ClickRippleEffect.ts', 'fx/easing.ts', 'fx/WinConfettiEffect.ts'];
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
    for (const [name, file] of Object.entries(pixiEntry.READY_UI_OPTIONAL_ASSET_FILES)) {
      expect(existsSync(resolve(assetsDir, file)), `${name} -> ${file}`).toBe(true);
    }
    expect(existsSync(resolve(assetsDir, pixiEntry.READY_UI_FONT_FILE))).toBe(true);
    expect(Object.keys(pixiEntry.createReadyUiTextures(pixiEntry.DEFAULT_READY_UI_THEME as never)).length)
      .toBe(Object.keys(pixiEntry.READY_UI_ASSET_FILES).length + Object.keys(pixiEntry.READY_UI_OPTIONAL_ASSET_FILES).length);
  });

  it('the Figma confirm-exit art is not in the required pack: the manifest a skin must ship is unchanged (71 keys)', () => {
    const required = Object.keys(pixiEntry.READY_UI_ASSET_FILES);
    expect(required.length).toBe(71);
    for (const name of Object.keys(pixiEntry.READY_UI_OPTIONAL_ASSET_FILES)) expect(required).not.toContain(name);
    expect(Object.keys(pixiEntry.READY_UI_OPTIONAL_ASSET_FILES).sort()).toEqual([
      'brokenHeart', 'buttonGreen', 'buttonHighlight', 'buttonOrange', 'fxGlowSoft', 'fxSparkStar', 'iconAd', 'iconCoin', 'iconHeart',
      'livesHeart', 'messageGlow', 'panelInset', 'windowBase', 'windowClose'
    ]);
  });

  it('ships the Figma confirm-exit textures lossless at their @Nx density, 9-slice textures = caps + an 8-unit centre', () => {
    const webp = (file: string) => {
      const b = readFileSync(resolve(rootDir, 'assets/pixi-ui', file));
      expect(b.toString('ascii', 12, 16)).toBe('VP8L');
      const bits = b.readUInt32LE(21);
      const px = [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
      const density = Number(/@([\d.]+)x\./.exec(file)?.[1]);
      return { px, units: px.map((v) => v / density) };
    };
    const files = pixiEntry.READY_UI_OPTIONAL_ASSET_FILES;
    // figma.json sizes (SVG export boxes, units): close 51 × 51, heart 326 × 298, glow 902 × 806
    expect(webp(files.windowClose)).toEqual({ px: [102, 102], units: [51, 51] });
    expect(webp(files.brokenHeart)).toEqual({ px: [652, 596], units: [326, 298] });
    expect(webp(files.messageGlow)).toEqual({ px: [451, 403], units: [902, 806] });
    for (const key of ['windowBase', 'buttonGreen'] as const) {
      const caps = pixiEntry.READY_UI_NINE_SLICES[key];
      expect(webp(files[key]).units, key).toEqual([caps.left + 8 + caps.right, caps.top + 8 + caps.bottom]);
    }
    // the Figma @stretch insets + the art's bleed, grown where the raster proved a cap too small, + the 8-unit seam gutter
    expect(pixiEntry.READY_UI_NINE_SLICES.windowBase).toEqual({ left: 92, top: 187, right: 92, bottom: 110, pad: { left: 4, top: 4, right: 4, bottom: 8 } });
    expect(pixiEntry.READY_UI_NINE_SLICES.buttonGreen).toEqual({ left: 67, top: 69, right: 67, bottom: 89 });
  });

  it('loadReadyUiAssets requests the Figma art only on `include` (strictly); by default it asks for exactly the 71 required files', async () => {
    const texture = () => new Texture({ source: new TextureSource({ width: 1, height: 1 }) });
    const optionalFiles = Object.values(pixiEntry.READY_UI_OPTIONAL_ASSET_FILES) as string[];
    const requested: string[] = [];
    let missing = new Set<string>();
    const load = vi.spyOn(Assets, 'load').mockImplementation((async (urls: unknown) => {
      for (const u of Array.isArray(urls) ? urls : [urls]) requested.push(String((u as { src: string }).src));
      if (Array.isArray(urls)) return {}; // the required bundle
      const src = String((urls as { src: string }).src);
      if (missing.has(src)) throw new Error('404');
      return texture();
    }) as never);
    const get = vi.spyOn(Assets, 'get').mockImplementation((() => texture()) as never);
    const optionalRequests = () => requested.filter((src) => optionalFiles.some((file) => src.endsWith(file)));
    try {
      // an existing skin / game: the 71 required files + the font, not one request for the Figma art
      const old = await pixiEntry.loadReadyUiAssets({ baseUrl: '/old-skin/' });
      expect(requested.length).toBe(71 + 1);
      expect(optionalRequests()).toEqual([]);
      expect(Object.keys(old).length).toBe(71);

      // the Figma confirm skin asks for its own five, and gets them
      requested.length = 0;
      const figma = await pixiEntry.loadReadyUiAssets({ baseUrl: '/core-pack/', include: pixiEntry.CONFIRM_EXIT_FIGMA_TEXTURES });
      const filesOf = (names: readonly (keyof typeof pixiEntry.READY_UI_OPTIONAL_ASSET_FILES)[]) => names.map((name) => `/core-pack/${pixiEntry.READY_UI_OPTIONAL_ASSET_FILES[name]}`).sort();
      expect(optionalRequests().sort()).toEqual(filesOf(pixiEntry.CONFIRM_EXIT_FIGMA_TEXTURES));
      expect(Object.keys(figma).length).toBe(71 + 5);
      expect(figma.windowBase).toBeInstanceOf(Texture);

      // the WIN confetti asks for its own two (spark + glow), and nothing else optional
      requested.length = 0;
      const confetti = await pixiEntry.loadReadyUiAssets({ baseUrl: '/core-pack/', include: pixiEntry.WIN_CONFETTI_TEXTURES });
      expect(optionalRequests().sort()).toEqual(filesOf(pixiEntry.WIN_CONFETTI_TEXTURES));
      expect(optionalRequests().sort()).toEqual(['/core-pack/fx/glow_soft.webp', '/core-pack/fx/spark_star.webp']);
      expect(Object.keys(confetti).length).toBe(71 + 2);
      expect(confetti.fxSparkStar).toBeInstanceOf(Texture);

      // the Figma Lives window asks for its own ten (the shared shell / close / green surface included), nothing else
      requested.length = 0;
      const lives = await pixiEntry.loadReadyUiAssets({ baseUrl: '/core-pack/', include: pixiEntry.LIVES_FIGMA_TEXTURES });
      expect(optionalRequests().sort()).toEqual(filesOf(pixiEntry.LIVES_FIGMA_TEXTURES));
      expect(Object.keys(lives).length).toBe(71 + 10);
      expect(lives.buttonOrange).toBeInstanceOf(Texture);

      // requested but absent: a clear rejection naming the file (only on this path)
      missing = new Set(['/old-skin/window/window_base@2x.webp']);
      await expect(pixiEntry.loadReadyUiAssets({ baseUrl: '/old-skin/', include: pixiEntry.CONFIRM_EXIT_FIGMA_TEXTURES }))
        .rejects.toThrow('loadReadyUiAssets: "windowBase" (window/window_base@2x.webp) was requested but did not load from /old-skin/');
    } finally {
      load.mockRestore();
      get.mockRestore();
    }
  });

  it('ships the Figma Lives textures lossless at @2x; its 9-slices (orange surface, inner panel) = caps + an 8-unit centre', () => {
    const webp = (file: string) => {
      const b = readFileSync(resolve(rootDir, 'assets/pixi-ui', file));
      expect(b.toString('ascii', 12, 16)).toBe('VP8L');
      const bits = b.readUInt32LE(21);
      return [((bits & 0x3fff) + 1) / 2, (((bits >> 14) & 0x3fff) + 1) / 2]; // every Lives file is @2x
    };
    const files = pixiEntry.READY_UI_OPTIONAL_ASSET_FILES;
    // figma.json sizes (SVG export boxes, units)
    expect(webp(files.buttonHighlight)).toEqual([307, 172]);
    expect(webp(files.livesHeart)).toEqual([326, 298]);
    expect(webp(files.iconCoin)).toEqual([100, 100]);
    expect(webp(files.iconHeart)).toEqual([154, 154]);
    expect(webp(files.iconAd)).toEqual([128, 134]);
    for (const key of ['buttonOrange', 'panelInset'] as const) {
      const caps = pixiEntry.READY_UI_NINE_SLICES[key];
      expect(webp(files[key]), key).toEqual([caps.left + 8 + caps.right, caps.top + 8 + caps.bottom]);
    }
    // measured on the raster: orange has the green surface's geometry; the plain panel gets its radius + the gutter
    expect(pixiEntry.READY_UI_NINE_SLICES.buttonOrange).toEqual(pixiEntry.READY_UI_NINE_SLICES.buttonGreen);
    expect(pixiEntry.READY_UI_NINE_SLICES.panelInset).toEqual({ left: 58, top: 58, right: 58, bottom: 58 });
  });

  it('the Figma Lives sources carry no text: the count, countdown, price and labels are runtime', () => {
    const figma = JSON.parse(readFileSync(resolve(rootDir, 'docs/figma/lives/figma.json'), 'utf-8'));
    for (const asset of figma.assets) {
      for (const layer of asset.layers) {
        const svg = readFileSync(resolve(rootDir, 'docs/figma/lives', layer.svg), 'utf-8');
        expect(svg, layer.svg).not.toMatch(/<text|<tspan|<image|font-family/);
      }
    }
  });

  it('the Figma sources carry no text: title, body, the "-1" and the button label are runtime', () => {
    const figma = JSON.parse(readFileSync(resolve(rootDir, 'docs/figma/confirm-exit/figma.json'), 'utf-8'));
    for (const asset of figma.assets) {
      for (const layer of asset.layers) {
        const svg = readFileSync(resolve(rootDir, 'docs/figma/confirm-exit', layer.svg), 'utf-8');
        expect(svg, layer.svg).not.toMatch(/<text|<tspan|<image|font-family/);
      }
    }
  });

  it('ships the donor ConfirmWindow art at its donor size (lossless crops of Trail Arrow confirm.r2209: back.png / btn-confirm.png)', () => {
    const size = (file: string) => {
      const b = readFileSync(resolve(rootDir, 'assets/pixi-ui', file));
      expect(b.toString('ascii', 12, 16)).toBe('VP8L');
      const bits = b.readUInt32LE(21);
      return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
    };
    expect(size(pixiEntry.READY_UI_ASSET_FILES.confirmPanel)).toEqual([968, 1006]);
    expect(size(pixiEntry.READY_UI_ASSET_FILES.confirmButton)).toEqual([600, 206]);
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
