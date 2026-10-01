import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const outDir = resolve(rootDir, 'showcase-shots/localization');
const WAIT_MS = 20_000;
mkdirSync(outDir, { recursive: true });

function fail(message) {
  throw new Error(message);
}

function expect(condition, message) {
  if (!condition) fail(message);
}

async function twoFrames(page) {
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

async function waitShown(page, expression) {
  await page.waitForFunction(`${expression}.state === 'shown'`, null, { timeout: WAIT_MS });
  await twoFrames(page);
}

async function centre(page, expression) {
  return page.evaluate((source) => {
    const node = Function(`return (${source})`)();
    const bounds = node.getBounds();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  }, expression);
}

async function readTexts(page, expression) {
  return page.evaluate((source) => {
    const root = Function(`return (${source})`)();
    const texts = [];
    const visit = (node) => {
      if (!node || node.visible === false || node.renderable === false) return;
      if (typeof node.text === 'string' && node.text.length > 0) {
        const bounds = node.getBounds();
        texts.push({
          text: node.text,
          bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
        });
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(root);
    return texts;
  }, expression);
}

function expectTexts(actual, expected, label) {
  const values = actual.map(({ text }) => text);
  for (const text of expected) {
    expect(values.includes(text), `${label}: missing localized text ${JSON.stringify(text)} in ${JSON.stringify(values)}`);
  }
}

function expectNoViewportClipping(texts, label) {
  const tolerance = 5;
  const clipped = texts.filter(({ bounds }) => bounds.width > 0 && bounds.height > 0 && (
    bounds.x < -tolerance || bounds.y < -tolerance ||
    bounds.x + bounds.width > 390 + tolerance || bounds.y + bounds.height > 844 + tolerance
  ));
  expect(clipped.length === 0, `${label}: visible text outside 390x844 viewport: ${JSON.stringify(clipped)}`);
}

async function translated(page, hook, specs) {
  return page.evaluate(({ hookName, entries }) => {
    const i18n = window[hookName].i18n;
    return entries.map(({ key, params }) => i18n.t(key, params));
  }, { hookName: hook, entries: specs.map((spec) => typeof spec === 'string' ? { key: spec } : spec) });
}

async function closeMainWindows(page) {
  await page.evaluate(() => {
    const demo = window.__showcase;
    for (const name of ['resultWindow', 'shopWindow', 'livesWindow', 'settingsWindow', 'noAdsWindow', 'starterWindow']) {
      const view = demo[name];
      if (view.state !== 'hidden') view.close('programmatic');
    }
  });
  await page.waitForFunction(() => {
    const demo = window.__showcase;
    return ['resultWindow', 'shopWindow', 'livesWindow', 'settingsWindow', 'noAdsWindow', 'starterWindow']
      .every((name) => demo[name].state === 'hidden');
  }, null, { timeout: WAIT_MS });
}

async function mainLocaleProof(browser, baseUrl, locale, errors) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const page = await context.newPage();
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`[main/${locale}] ${message.text()}`); });
  page.on('pageerror', (error) => errors.push(`[main/${locale}] ${error.message}`));
  await page.goto(new URL(`?locale=${locale}&skin=style1`, baseUrl).href, { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.__showcase), null, { timeout: WAIT_MS });
  await closeMainWindows(page);

  const boot = await page.evaluate(() => ({
    locale: window.__showcase.i18n.locale,
    hard: window.__showcase.map.hardLabel,
    hardExpected: window.__showcase.i18n.t('core.level_map.hard')
  }));
  expect(boot.locale === locale, `main/${locale}: runtime resolved ${boot.locale}`);
  expect(boot.hard === boot.hardExpected, `main/${locale}: LevelMap did not use i18n`);

  await page.evaluate(() => {
    const demo = window.__showcase;
    demo.hud.setLives(demo.state.maxLives ?? 5, '');
  });
  const hudTexts = await readTexts(page, 'window.__showcase.hud');
  expectTexts(hudTexts, await translated(page, '__showcase', ['core.common.max']), `HUD/${locale}`);
  await page.screenshot({ path: resolve(outDir, `${locale}-style1-map-hud.png`) });

  await page.evaluate(() => window.__showcase.openSettings(false));
  await waitShown(page, 'window.__showcase.settingsWindow');
  let texts = await readTexts(page, 'window.__showcase.settingsWindow');
  expectTexts(texts, await translated(page, '__showcase', [
    'core.settings.title', 'core.settings.sound', 'core.settings.music', 'core.settings.haptic'
  ]), `Settings map/${locale}`);
  expectNoViewportClipping(texts, `Settings map/${locale}`);
  await page.screenshot({ path: resolve(outDir, `${locale}-style1-settings-map.png`) });

  const soundAt = await centre(page, 'window.__showcase.settingsWindow.toggles.sound.button');
  await page.mouse.click(soundAt.x, soundAt.y);
  await page.waitForFunction(() => window.__showcase.settings.sound === false, null, { timeout: WAIT_MS });
  const closeAt = await centre(page, 'window.__showcase.settingsWindow.closeButton');
  await page.mouse.click(closeAt.x, closeAt.y);
  await page.waitForFunction(() => window.__showcase.settingsWindow.state === 'hidden', null, { timeout: WAIT_MS });

  await page.evaluate(() => window.__showcase.openSettings(true));
  await waitShown(page, 'window.__showcase.settingsWindow');
  texts = await readTexts(page, 'window.__showcase.settingsWindow');
  expectTexts(texts, await translated(page, '__showcase', [
    'core.settings.title', 'core.settings.sound', 'core.settings.music', 'core.settings.exit', 'core.settings.restart'
  ]), `Settings gameplay/${locale}`);
  expectNoViewportClipping(texts, `Settings gameplay/${locale}`);
  await page.screenshot({ path: resolve(outDir, `${locale}-style1-settings-gameplay.png`) });
  const restartAt = await centre(page, 'window.__showcase.settingsWindow.restartButton');
  await page.mouse.click(restartAt.x, restartAt.y);
  await page.waitForFunction(() => window.__showcase.settingsActions.includes('restart'), null, { timeout: WAIT_MS });

  const coinsBefore = await page.evaluate(() => window.__showcase.state.coins);
  await page.evaluate(() => window.__showcase.openResult(12));
  await waitShown(page, 'window.__showcase.resultWindow');
  texts = await readTexts(page, 'window.__showcase.resultWindow');
  expectTexts(texts, await translated(page, '__showcase', [
    { key: 'core.result.level', params: { level: 12 } }, 'core.result.completed', 'core.result.rewards', 'core.result.continue'
  ]), `Result/${locale}`);
  expectNoViewportClipping(texts, `Result/${locale}`);
  await page.screenshot({ path: resolve(outDir, `${locale}-style1-result.png`) });
  const nextAt = await centre(page, 'window.__showcase.resultWindow.nextButton');
  await page.mouse.click(nextAt.x, nextAt.y);
  await page.waitForFunction(() => window.__showcase.resultWindow.state === 'hidden', null, { timeout: WAIT_MS });
  expect(await page.evaluate((before) => window.__showcase.state.coins > before, coinsBefore), `Result/${locale}: real CONTINUE tap did not run host callback`);

  await context.close();
  return { locale, hard: boot.hard };
}

async function standaloneProof(browser, baseUrl, locale, kind, errors) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const page = await context.newPage();
  const hook = kind === 'confirm' ? '__confirm' : '__lives';
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`[${kind}/${locale}] ${message.text()}`); });
  page.on('pageerror', (error) => errors.push(`[${kind}/${locale}] ${error.message}`));
  await page.goto(new URL(`${kind}.html?locale=${locale}&skin=1`, baseUrl).href, { waitUntil: 'load' });
  await page.waitForFunction((name) => Boolean(window[name]), hook, { timeout: WAIT_MS });
  await page.waitForFunction((name) => window[name].state() === 'shown', hook, { timeout: WAIT_MS });
  await twoFrames(page);

  const info = await page.evaluate((name) => ({
    locale: window[name].i18n.locale,
    skin: window[name].skin,
    variant: window[name].scene().variant
  }), hook);
  expect(info.locale === locale, `${kind}/${locale}: runtime resolved ${info.locale}`);
  expect(info.skin === 'style-1', `${kind}/${locale}: Style 1 was not retained`);
  const specs = kind === 'confirm'
    ? ['core.confirm.title', 'core.confirm.lose_life', 'core.confirm.exit']
    : ['core.lives.title', 'core.lives.next', 'core.lives.refill', 'core.lives.ad_action'];
  const texts = await readTexts(page, `window.${hook}.view`);
  expectTexts(texts, await translated(page, hook, specs), `${kind}/${locale}`);
  expectNoViewportClipping(texts, `${kind}/${locale}`);
  await page.screenshot({ path: resolve(outDir, `${locale}-style1-${kind}.png`) });

  if (kind === 'confirm') {
    let at = await page.evaluate(() => window.__confirm.tap('close'));
    await page.mouse.click(at.x, at.y);
    await page.waitForFunction(() => window.__confirm.state() === 'hidden', null, { timeout: WAIT_MS });
    await page.evaluate(() => window.__confirm.show());
    await waitShown(page, 'window.__confirm.view');
    at = await page.evaluate(() => window.__confirm.tap('confirm'));
    await page.mouse.click(at.x, at.y);
    await page.waitForFunction(() => window.__confirm.state() === 'hidden', null, { timeout: WAIT_MS });
    const events = await page.evaluate(() => window.__confirm.events);
    expect(JSON.stringify(events) === JSON.stringify(['dismiss:button', 'confirm']), `confirm/${locale}: callbacks ${JSON.stringify(events)}`);
  } else {
    const at = await page.evaluate(() => window.__lives.tap('refill'));
    await page.mouse.click(at.x, at.y);
    await page.waitForFunction(() => window.__lives.state() === 'hidden', null, { timeout: WAIT_MS });
    const events = await page.evaluate(() => window.__lives.events);
    expect(JSON.stringify(events) === JSON.stringify(['refill:1']), `lives/${locale}: callback ${JSON.stringify(events)}`);
  }

  await context.close();
  return info;
}

async function donorSmoke(browser, baseUrl, errors) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const page = await context.newPage();
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`[donor] ${message.text()}`); });
  page.on('pageerror', (error) => errors.push(`[donor] ${error.message}`));
  await page.goto(new URL('confirm.html?donor=1&legacy=1', baseUrl).href, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__confirm?.state() === 'shown', null, { timeout: WAIT_MS });
  await twoFrames(page);
  const info = await page.evaluate(() => ({ provider: window.__confirm.provider, skin: window.__confirm.skin, variant: window.__confirm.scene().variant }));
  expect(JSON.stringify(info) === JSON.stringify({ provider: false, skin: null, variant: 'donor' }), `donor compatibility: ${JSON.stringify(info)}`);
  await page.screenshot({ path: resolve(outDir, 'donor-no-provider-confirm.png') });
  const at = await page.evaluate(() => window.__confirm.tap('confirm'));
  await page.mouse.click(at.x, at.y);
  await page.waitForFunction(() => window.__confirm.state() === 'hidden', null, { timeout: WAIT_MS });
  expect(JSON.stringify(await page.evaluate(() => window.__confirm.events)) === JSON.stringify(['confirm']), 'donor compatibility: confirm callback failed');
  await context.close();
}

async function run(baseUrl) {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', headless: true });
  const errors = [];
  try {
    const styleProofs = [];
    for (const locale of ['en', 'ru']) {
      await mainLocaleProof(browser, baseUrl, locale, errors);
      styleProofs.push(await standaloneProof(browser, baseUrl, locale, 'confirm', errors));
      styleProofs.push(await standaloneProof(browser, baseUrl, locale, 'lives', errors));
    }
    expect(styleProofs.every(({ skin }) => skin === styleProofs[0].skin), 'locale changed the selected UI skin');
    await donorSmoke(browser, baseUrl, errors);
  } finally {
    await browser.close();
  }
  expect(errors.length === 0, `browser console errors:\n${errors.join('\n')}`);
}

let server;
let baseUrl = process.env.SHOWCASE_URL;
if (!baseUrl) {
  const { createServer } = await import('vite');
  server = await createServer({
    configFile: resolve(rootDir, 'vite.showcase.config.ts'),
    server: { host: '127.0.0.1', port: 5197, strictPort: false },
    logLevel: 'error'
  });
  await server.listen();
  baseUrl = server.resolvedUrls.local[0];
}

try {
  await run(baseUrl);
  console.log(`localization-check: OK — RU/EN Style 1 + donor proof at 390x844; screenshots in ${outDir}`);
} catch (error) {
  console.error(`localization-check: FAILED — ${error.message}`);
  process.exitCode = 1;
} finally {
  await server?.close();
}
