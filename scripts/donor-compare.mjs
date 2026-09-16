// Visual-parity reference: screenshots + geometry dumps of the DONOR (Trail Arrow dev server)
// at the same viewport the showcase is checked at. READ ONLY: it only drives the running game.
//
//   (workspace)  sh -c "cd trail_arrow && npx vite --mode localhost --host 0.0.0.0 --port 8090"
//   DONOR_URL=http://127.0.0.1:8090/ node scripts/donor-compare.mjs
//
// Writes showcase-shots/donor/*.png and showcase-shots/donor/*.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, devices } from 'playwright';

const url = process.env.DONOR_URL ?? 'http://127.0.0.1:8090/';
const outDir = process.env.SHOTS_DIR ?? resolve(process.cwd(), 'showcase-shots/donor');
mkdirSync(outDir, { recursive: true });

const PROFILE_KEY = process.env.DONOR_PROFILE_KEY ?? 'hazargames.arrow.profile';
const STAR_PATTERN = [3, 2, 3, 1, 3, 3, 2, 0, 3, 1, 2, 3, 3, 2, 1, 3, 2, 3];
const DEMO_PROFILE = {
  settings: { soundEnabled: true, musicEnabled: true, hapticEnabled: true },
  levelStars: Object.fromEntries(Array.from({ length: 18 }, (_, i) => [String(i + 1), STAR_PATTERN[i % STAR_PATTERN.length]])),
  resources: [
    { id: 'level', amount: 19 }, { id: 'soft', amount: 12450 }, { id: 'hard', amount: 100 },
    { id: 'lives', amount: 3 }, { id: 'lives_max', amount: 5 }, { id: 'lives_update_seconds', amount: 0 }, { id: 'lives_unlimited_until', amount: 0 },
    // owned starter pack: no auto-offer on the main screen and no side icon over the map
    { id: 'starter_pack', amount: 1 }, { id: 'no_ads', amount: 0 }
  ]
};

const ONLY = process.env.DONOR_ONLY ? new Set(process.env.DONOR_ONLY.split(',')) : null;
const WINDOWS = [
  { name: 'shop', module: '/src/windows/ShopWindow.ts', cls: 'ShopWindow', params: null },
  { name: 'lives', module: '/src/windows/RefillHeartsWindow.ts', cls: 'RefillHeartsWindow', params: { level: 12 } },
  { name: 'settings', module: '/src/windows/SettingsWindow.ts', cls: 'SettingsWindow', params: null },
  { name: 'noads', module: '/src/windows/OfferNoAdsWindow.ts', cls: 'OfferNoAdsWindow', params: null },
  { name: 'starter', module: '/src/windows/OfferStarterPackWindow.ts', cls: 'OfferStarterPackWindow', params: null },
  { name: 'result', module: null, cls: null, params: null }
];

// serialisable scene dump: label / transform / bounds / text, limited depth and fan-out
const DUMP_FN = `(root, maxDepth) => {
  const walk = (n, depth) => {
    if (!n) return null;
    const out = { type: n.constructor?.name, label: n.label ?? null, x: +n.x.toFixed(1), y: +n.y.toFixed(1), sx: +n.scale.x.toFixed(3), sy: +n.scale.y.toFixed(3), visible: n.visible, alpha: +n.alpha.toFixed(2) };
    try { const b = n.getBounds(); out.screen = [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; } catch {}
    if (typeof n.text === 'string') { out.text = n.text; out.fontSize = n.style?.fontSize; out.resolution = n._resolution ?? n.resolution; }
    if (n.texture?.label || n.texture?.source?.label) out.texture = n.texture.label ?? n.texture.source.label;
    if (depth < maxDepth && n.children?.length) out.children = n.children.slice(0, 14).map((c) => walk(c, depth + 1));
    return out;
  };
  return walk(root, 0);
}`;

async function main() {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  // seed the localhost profile BEFORE boot: level 19 with the showcase's demo stars, 12 450 coins,
  // 3/5 lives — a fresh level-1 profile would start straight on the GameScreen
  await context.addInitScript(({ key, profile }) => {
    try { window.localStorage.setItem(key, JSON.stringify(profile)); } catch {}
  }, { key: PROFILE_KEY, profile: DEMO_PROFILE });

  const open = async () => {
    const page = await context.newPage();
    page.on('pageerror', (e) => console.log('  pageerror', e.message));
    await page.goto(url.includes('?') ? url : `${url}?lang=en`, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.__chainInfo), null, { timeout: 120000 });
    await page.waitForTimeout(1500);
    console.log('  donor chain', JSON.stringify(await page.evaluate(() => ({ current: window.__chainInfo.current, level: app.model.level }))));
    return page;
  };

  // main screen
  let page = await open();
  await page.screenshot({ path: resolve(outDir, 'main.png') });
  const info = await page.evaluate(async (dumpSrc) => {
    const dump = eval(dumpSrc);
    const { AppLayers } = await import('/src/app/AppLayers.ts');
    const { RendererComponent } = await import('/src/app/Components.ts');
    const layers = app.engine.findEntity([AppLayers]).get(AppLayers);
    const renderer = app.engine.findEntity([RendererComponent]).get(RendererComponent).renderer;
    const canvas = document.querySelector('canvas');
    const screen = layers.screens.children[0];
    const pick = (label) => screen.children.find((c) => c.label === label) ?? null;
    return {
      dpr: window.devicePixelRatio,
      rendererResolution: renderer.resolution,
      screenSize: [renderer.screen.width, renderer.screen.height],
      canvasBacking: [canvas.width, canvas.height],
      canvasCss: [canvas.clientWidth, canvas.clientHeight],
      scaleFactor: app.environment.scaleFactor,
      stageScale: renderer.stage.scale.x,
      chain: window.__chainInfo,
      topResources: dump(pick('topResources'), 3),
      btnSettings: dump(pick('btnSettings'), 2),
      btnPlay: dump(pick('btnPlay'), 2),
      progression: dump(pick('progression'), 1),
      firstNode: (() => { const prog = pick('progression'); const track = prog.children.find((c) => c.children?.length > 2 && c !== prog.shine); const nodeLayer = track?.children?.[2]; const node = nodeLayer?.children?.[0]; return node ? dump(node, 2) : null; })()
    };
  }, DUMP_FN);
  writeFileSync(resolve(outDir, 'main.json'), JSON.stringify(info, null, 2));
  console.log('main', JSON.stringify({ dpr: info.dpr, res: info.rendererResolution, backing: info.canvasBacking, css: info.canvasCss, scaleFactor: info.scaleFactor }));
  await page.close();

  for (const win of WINDOWS) {
    if (ONLY && !ONLY.has(win.name)) continue;
    page = await open();
    if (win.cls) {
      await page.evaluate(async ({ module, cls, params }) => {
        const { ShowWindowComponent } = await import('/src/app/Components.ts');
        const mod = await import(module);
        app.engine.insertEventEntity(new ShowWindowComponent(mod[cls], params));
      }, win);
    } else {
      await page.evaluate(() => window.__showWin());
    }
    await page.waitForFunction(async () => {
      const { AppLayers } = await import('/src/app/AppLayers.ts');
      const layers = app.engine.findEntity([AppLayers]).get(AppLayers);
      return layers.windows.children.length > 0;
    }, null, { timeout: 30000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: resolve(outDir, `${win.name}.png`) });
    const geometry = await page.evaluate(async (dumpSrc) => {
      const dump = eval(dumpSrc);
      const { AppLayers } = await import('/src/app/AppLayers.ts');
      const layers = app.engine.findEntity([AppLayers]).get(AppLayers);
      return { window: dump(layers.windows.children[0], 4), locker: layers.windowBackgroundLocker.children.map((c) => dump(c, 0)) };
    }, DUMP_FN);
    writeFileSync(resolve(outDir, `${win.name}.json`), JSON.stringify(geometry, null, 2));
    console.log(`window ${win.name}: scale ${geometry.window.sx} at`, geometry.window.screen);
    await page.close();
  }
  await browser.close();
  console.log('donor shots: OK');
}

main().catch((error) => { console.error(error); process.exit(1); });
