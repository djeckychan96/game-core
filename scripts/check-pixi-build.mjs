// Post-build smoke check for the `game-core/pixi` public entry:
//  - the built ESM bundle exists, imports pixi.js as an external (never bundled), and exposes
//    the documented kit classes;
//  - the root bundle stays renderer-agnostic (no pixi.js import, no kit classes);
//  - the rolled-up type declarations exist.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fail = (message) => {
  console.error(`check-pixi-build: ${message}`);
  process.exit(1);
};

const pixiBundle = resolve(rootDir, 'dist/pixi/game-core-pixi.es.js');
const pkg = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf-8'));
const pixiExport = pkg.exports?.['./pixi'];
if (!pixiExport?.types || !pixiExport?.import) fail('package.json lacks the "./pixi" export');
const pixiTypes = resolve(rootDir, pixiExport.types);
if (resolve(rootDir, pixiExport.import) !== resolve(rootDir, 'dist/pixi/game-core-pixi.es.js')) fail('"./pixi" import path drifted');
const coreBundle = resolve(rootDir, 'dist/game-core.es.js');
for (const file of [pixiBundle, pixiTypes, coreBundle]) {
  if (!existsSync(file)) fail(`missing ${file}`);
}

const pixiSource = readFileSync(pixiBundle, 'utf-8');
if (!/from\s*["']pixi\.js["']/.test(pixiSource)) fail('dist/pixi bundle does not import pixi.js as an external');
if (/class\s+Application\b/.test(pixiSource) || /WebGLRenderer/.test(pixiSource)) fail('dist/pixi bundle appears to inline PixiJS');

const coreSource = readFileSync(coreBundle, 'utf-8');
if (/pixi\.js/.test(coreSource)) fail('root bundle references pixi.js');
if (/LevelMapView|HudView|ResultWindowView|ClickRippleEffect/.test(coreSource)) fail('root bundle contains Pixi kit classes');

const mod = await import(pathToFileURL(pixiBundle).href);
const expected = [
  'LevelMapView', 'HudView', 'UiButton', 'ModalWindow', 'ResultWindowView', 'LivesWindowView', 'ShopWindowView',
  'loadReadyUiAssets', 'createReadyUiTextures', 'READY_UI_ASSET_FILES', 'DEFAULT_READY_UI_THEME', 'resolveTheme',
  'createLabel', 'formatAmount', 'formatTimer', 'backOut', 'ClickRippleEffect', 'DEFAULT_CLICK_RIPPLE'
];
for (const name of expected) {
  if (!(name in mod)) fail(`dist/pixi entry lacks export ${name}`);
}

const types = readFileSync(pixiTypes, 'utf-8');
for (const name of ['LevelMapView', 'HudView', 'ResultWindowView', 'ReadyUiTextures', 'ClickRippleEffect']) {
  if (!types.includes(name)) fail(`${pixiExport.types} lacks ${name}`);
}
// the kit's declarations import the foundation types relatively; they must ship next to them
for (const rel of ['dist/pixi/index.d.ts', 'dist/pixi/ui/types.d.ts', 'dist/pixi/motion/types.d.ts', 'dist/pixi/pixi/LevelMapView.d.ts', 'dist/pixi/pixi/fx/ClickRippleEffect.d.ts']) {
  if (!existsSync(resolve(rootDir, rel))) fail(`missing declaration ${rel}`);
}

const assetsDir = resolve(rootDir, 'assets/pixi-ui');
for (const rel of Object.values(mod.READY_UI_ASSET_FILES)) {
  if (!existsSync(resolve(assetsDir, rel))) fail(`asset missing on disk: assets/pixi-ui/${rel}`);
}
if (!existsSync(resolve(assetsDir, mod.READY_UI_FONT_FILE))) fail('font missing on disk');

console.log(`check-pixi-build: OK (${expected.length} exports, ${Object.keys(mod.READY_UI_ASSET_FILES).length} assets, pixi.js external)`);
