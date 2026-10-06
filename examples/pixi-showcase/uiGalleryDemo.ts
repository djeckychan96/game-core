// Ready UI gallery: every public Ready UI view of one style on one page, for a manual look at Style 1 / Style 2.
// The style is the game's one choice (`theme: { skin }` + `loadReadyUiAssets({ skin })`), so switching it reloads the
// page. Query:
//   ?style=1 | 2     the style (default 1)
//   ?screen=<id>     the window over the map screen (default map = no window); ids in SCREENS below. Both styles draw
//                    the same LevelMapScreen contract (select a level → PLAY, SHOP | HOME | LOCK); every callback lands
//                    in the status line ("last: …")
//   ?locale=ru       showcase/manual-QA locale override — production gets it from the ready platform
//   ?ui=0            hide the gallery controls (screenshots)
// Demo data only; nothing is bought, no level is played. The booster icons of the OFFER (gallery/*.webp, the Figma
// sample's lamp and wand) are game content a host passes as textures — not part of Core.
import { Application, Assets, type Texture } from 'pixi.js';
import { CoreRuntime, MotionRuntime, UiRuntime } from 'game-core';
import {
  ConfirmWindowView,
  type HudView,
  LevelMapScreen,
  LivesWindowView,
  READY_UI_STYLE_1,
  READY_UI_STYLE_2,
  ResultWindowView,
  SettingsWindowView,
  ShopWindowView,
  formatTimer,
  loadReadyUiAssets,
  type LevelMapLevel,
  type ModalWindow,
  type ReadyUiOffer,
  type ReadyUiSkin,
  type ReadyUiThemeOverrides
} from 'game-core/pixi';
import { DEMO_SHOP_ITEMS } from './demoData';
import { createShowcaseLocalization } from './localizationDemo';

const SCREENS = [
  { id: 'map', label: 'LevelMap — PLAY + SHOP | HOME | LOCK' },
  { id: 'map-disabled', label: 'LevelMap — SHOP / LOCK disabled' },
  { id: 'settings-map', label: 'Settings — compact, no language' },
  { id: 'settings-map-lang', label: 'Settings — with language' },
  { id: 'settings-level', label: 'Settings in level — no language' },
  { id: 'settings-level-lang', label: 'Settings in level — with language' },
  { id: 'restart', label: 'Confirm Restart' },
  { id: 'restart-offer', label: 'Confirm Restart + OFFER' },
  { id: 'exit', label: 'Confirm Exit' },
  { id: 'lives-minimal', label: 'Lives — minimal' },
  { id: 'lives', label: 'Lives — REFILL + GET' },
  { id: 'lives-full', label: 'Lives — full (REFILL + GET + OFFER)' },
  { id: 'win', label: 'Result WIN' },
  { id: 'fail', label: 'Result FAIL' },
  { id: 'shop', label: 'Shop / bank (coin packs)' }
] as const;
type ScreenId = (typeof SCREENS)[number]['id'];

const params = new URLSearchParams(location.search);
const styleNo = params.get('style') === '2' ? 2 : 1;
const screenId: ScreenId = SCREENS.find((s) => s.id === params.get('screen'))?.id ?? 'map';
const skin: ReadyUiSkin = styleNo === 2 ? READY_UI_STYLE_2 : READY_UI_STYLE_1;
const i18n = createShowcaseLocalization();
document.documentElement.lang = i18n.locale;
document.body.dataset.style = String(styleNo);

// --- gallery controls (DOM) ---
const bar = document.getElementById('gallery') as HTMLDivElement;
const note = document.getElementById('note') as HTMLDivElement;
const select = document.getElementById('screen') as HTMLSelectElement;
const localeSelect = document.getElementById('locale') as HTMLSelectElement;
if (params.get('ui') === '0') bar.style.display = 'none';
const go = (patch: Record<string, string>): void => {
  const next = new URLSearchParams(location.search);
  for (const [key, value] of Object.entries(patch)) next.set(key, value);
  location.search = next.toString();
};
for (const button of bar.querySelectorAll<HTMLButtonElement>('button[data-style]')) {
  button.setAttribute('aria-pressed', String(button.dataset.style === String(styleNo)));
  button.addEventListener('click', () => go({ style: button.dataset.style ?? '1' }));
}
for (const screen of SCREENS) select.add(new Option(screen.label, screen.id, false, screen.id === screenId));
select.addEventListener('change', () => go({ screen: select.value }));
localeSelect.value = i18n.locale;
localeSelect.addEventListener('change', () => go({ locale: localeSelect.value }));
const stage = document.getElementById('stage') as HTMLDivElement;
(document.getElementById('toggle') as HTMLButtonElement).addEventListener('click', () => bar.classList.toggle('hidden'));

// --- the host: one Pixi app, the Core runtimes, the host clock ---
const resolution = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
const app = new Application();
await app.init({ resizeTo: stage, resolution, autoDensity: true, antialias: true, backgroundAlpha: 0 });
stage.appendChild(app.canvas);
// the bar docks under the stage and changes height (collapsed, a wrapped status line): Pixi's resizeTo only hears
// window resizes, so the stage's own size drives the canvas
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => app.resize()).observe(stage);
const core = new CoreRuntime();
const motion = new MotionRuntime();
const ui = new UiRuntime({ motion });
core.registerRuntime('ui', ui);
core.registerRuntime('motion', motion);

const theme: ReadyUiThemeOverrides = styleNo === 2
  // Style 2's map spacing is the host's (docs/figma/style2-level-map-screen)
  ? { skin, levelMap: { badgeSize: 288, nodeScale: 1, levelGap: 402, focusBoost: 4 / 3, focusRatio: 1260 / 2344, contentScale: 1 } }
  : { skin };
const [textures, lamp, wand] = await Promise.all([
  loadReadyUiAssets({ baseUrl: './pixi-ui/', skin }),
  Assets.load<Texture>('./gallery/booster_lamp.webp'),
  Assets.load<Texture>('./gallery/booster_wand.webp')
]);
const base = { ui, motion, textures, i18n, theme };
const events: string[] = [];
const log = (event: string): void => {
  events.push(event);
  note.textContent = `${coverage()} · last: ${event}`;
};

// --- the map screen under the windows ---
const CURRENT = 12;
const levels: LevelMapLevel[] = [];
for (let i = 1; i <= 40; i++) levels.push({ index: i, stars: i < CURRENT ? [3, 2, 1, 3, 0][i % 5] ?? 0 : 0, ...(i % 7 === 0 ? { hard: true } : {}) });
let refillSeconds = 24 * 60 + 15;
// the same LevelMapScreen contract for both styles: a node tap selects its level, PLAY launches the selected one, the
// navigation is SHOP | HOME | LOCK (a slot without onTap is disabled); only the look is the style's
const navDisabled = screenId === 'map-disabled';
const mapScreen = new LevelMapScreen({
  ...base, id: 'map-screen',
  map: { levels, currentLevel: CURRENT, onLockedTap: (level) => log(`locked:${level}`), onFocusChange: ({ selectedLevel }) => log(`selected:${selectedLevel}`) },
  hud: {
    coins: styleNo === 2 ? 9990 : 12450, lives: 3, maxLives: 5, ...(styleNo === 2 ? { stars: 9990 } : {}),
    onLivesTap: () => go({ screen: 'lives-full' }), onCoinsTap: () => log('hud:coins'), onSettingsTap: () => go({ screen: 'settings-map' })
  },
  nav: navDisabled
    ? { home: { onTap: () => log('nav:home') } }
    : { shop: { onTap: () => log('nav:shop') }, home: { onTap: () => log('nav:home') }, lock: { onTap: () => log('nav:lock') } },
  onPlay: (level) => log(`play:${level}`)
});
const hud: HudView = mapScreen.hud;
const screen = mapScreen;
app.stage.addChild(mapScreen);
hud.setLives(3, formatTimer(refillSeconds));

// --- the window of this screen ---
const offerLives: ReadyUiOffer = { icon: 'offerLivesArt', iconLabel: '35d', items: [{ icon: lamp, label: '5' }, { icon: wand, label: '10' }], price: 900, badge: 'x3' };
const offerCoins: ReadyUiOffer = { icon: 'offerCoinArt', iconLabel: '2000', items: [{ icon: lamp, label: '5' }, { icon: wand, label: '10' }], price: 900, badge: 'x3' };
let view: ModalWindow<never> | null = null;
let open: () => void = () => {};
const onDismiss = (reason: string): void => log(`dismiss:${reason}`);
switch (screenId) {
  case 'settings-map':
  case 'settings-map-lang':
  case 'settings-level':
  case 'settings-level-lang': {
    const inLevel = screenId.startsWith('settings-level');
    const withLanguage = screenId.endsWith('-lang');
    const settings = new SettingsWindowView({
      ...base, id: 'settings', haptic: styleNo === 1, onDismiss,
      onToggle: (setting, enabled) => log(`toggle:${setting}:${enabled}`),
      ...(inLevel ? { onHome: () => log('settings:home'), onRestart: () => log('settings:restart') } : {}),
      // the host's locales; applying one (catalogs, rebuilt views) is the host's — here the page reloads in it
      ...(withLanguage ? {
        languages: [{ id: 'en', label: 'English' }, { id: 'ru', label: 'Русский' }],
        onLanguage: (locale: string) => log(`language:${locale}`)
      } : {})
    });
    open = () => settings.show({ sound: true, music: false, haptic: true, version: 'VERSION 1.0.0 (1)', gameButtons: inLevel, locale: i18n.locale });
    view = settings as unknown as ModalWindow<never>;
    break;
  }
  case 'shop': {
    // Core's coin shop (the bank): ShopWindowView — no style covers it yet, so both styles show its donor look
    const shop = new ShopWindowView({ ...base, id: 'shop', onDismiss, onBuy: (item) => log(`buy:${item.id}`) });
    open = () => shop.show({ items: DEMO_SHOP_ITEMS });
    view = shop as unknown as ModalWindow<never>;
    break;
  }
  case 'restart':
  case 'restart-offer':
  case 'exit': {
    const action = screenId === 'exit' ? 'exit' : 'restart';
    const confirm = new ConfirmWindowView({
      ...base, id: 'confirm', action, onDismiss,
      onConfirm: () => log(`confirm:${action}`),
      onOffer: (offer) => log(`offer:${offer.price}`)
    });
    open = () => confirm.show(screenId === 'restart-offer' ? { offer: offerCoins } : undefined);
    view = confirm as unknown as ModalWindow<never>;
    break;
  }
  case 'lives-minimal':
  case 'lives':
  case 'lives-full': {
    const lives = new LivesWindowView({
      ...base, id: 'lives', onDismiss,
      onRefill: (p) => log(`refill:${p.refillPrice}`),
      onWatchAd: () => log('ad:+1'),
      onOffer: (p) => log(`offer:${p.offer?.price ?? 0}`)
    });
    open = () => lives.show({
      lives: 1, maxLives: 5, timerText: formatTimer(refillSeconds), refillPrice: 900,
      ...(screenId === 'lives-minimal' ? { refillOffer: false, adOffer: false } : {}),
      ...(screenId === 'lives-full' ? { offer: offerLives } : {})
    });
    app.ticker.add(() => lives.setTimer(formatTimer(refillSeconds)));
    view = lives as unknown as ModalWindow<never>;
    break;
  }
  case 'win':
  case 'fail': {
    const result = new ResultWindowView({
      ...base, id: 'result', onDismiss,
      onNext: (p) => log(`next:${p.level}`), onRetry: (p) => log(`retry:${p.level}`), onExit: (p) => log(`exit:${p.level}`)
    });
    open = () => result.show(screenId === 'win' ? { level: CURRENT, stars: 3, rewardCoins: 500 } : { level: CURRENT, outcome: 'fail', rewardCoins: 0 });
    view = result as unknown as ModalWindow<never>;
    break;
  }
  default:
    break;
}
if (view) app.stage.addChild(view);

/** What this style draws for the screen: its own art, or the donor look where the style has no design. */
function coverage(): string {
  const window = screenId.startsWith('settings') ? 'settings' : screenId.startsWith('lives') ? 'lives' : screenId === 'win' || screenId === 'fail' ? 'result'
    : screenId.startsWith('map') ? 'levelMapScreen' : screenId === 'shop' ? 'shop' : 'confirm';
  const covered = skin.covers.includes(window as never);
  return `Style ${styleNo} · ${SCREENS.find((s) => s.id === screenId)?.label}: ${covered ? 'style art' : 'NOT in this style — donor look'}`;
}
note.textContent = coverage();

// --- layout + clock ---
const readSafe = () => {
  const probe = document.getElementById('safe-probe');
  const style = probe ? getComputedStyle(probe) : null;
  const px = (value: string | undefined) => Math.max(0, parseFloat(value ?? '') || 0);
  // the docked bar takes the bottom safe area when it is shown
  const bottom = bar.style.display === 'none' ? px(style?.paddingBottom) : 0;
  return { top: px(style?.paddingTop), right: px(style?.paddingRight), bottom, left: px(style?.paddingLeft) };
};
const layout = (): void => {
  const options = { insets: readSafe(), pixelRatio: resolution };
  screen.resize(app.screen.width, app.screen.height, options);
  view?.resize(app.screen.width, app.screen.height, options);
};
app.renderer.on('resize', layout);
layout();
let acc = 0;
app.ticker.add((ticker) => {
  core.update(ticker.deltaMS);
  acc += ticker.deltaMS;
  while (acc >= 1000) {
    acc -= 1000;
    refillSeconds = Math.max(0, refillSeconds - 1);
    hud.setLivesTimer(formatTimer(refillSeconds));
  }
});
open();
(document.getElementById('reopen') as HTMLButtonElement).addEventListener('click', () => {
  if (view && view.state === 'hidden') open();
});

(window as unknown as { __gallery: unknown }).__gallery = { app, core, ui, motion, view, screen, styleNo, screenId, events, open, layout, ready: true };
