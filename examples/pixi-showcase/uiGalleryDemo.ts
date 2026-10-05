// Ready UI gallery: every public Ready UI view of one style on one page, for a manual look at Style 1 / Style 2.
// The style is the game's one choice (`theme: { skin }` + `loadReadyUiAssets({ skin })`), so switching it reloads the
// page. Query:
//   ?style=1 | 2     the style (default 1)
//   ?screen=<id>     the window over the map screen (default map = no window); ids in SCREENS below
//   ?locale=ru       showcase/manual-QA locale override — production gets it from the ready platform
//   ?ui=0            hide the gallery controls (screenshots)
// Demo data only; nothing is bought, no level is played. The booster icons of the OFFER (gallery/*.webp, the Figma
// sample's lamp and wand) are game content a host passes as textures — not part of Core.
import { Application, Assets, type Texture } from 'pixi.js';
import { CoreRuntime, MotionRuntime, UiRuntime } from 'game-core';
import {
  ConfirmWindowView,
  HudView,
  LevelMapScreen,
  LevelMapView,
  LivesWindowView,
  READY_UI_STYLE_1,
  READY_UI_STYLE_2,
  ResultWindowView,
  SettingsWindowView,
  formatTimer,
  loadReadyUiAssets,
  type LevelMapLevel,
  type ModalWindow,
  type ReadyUiOffer,
  type ReadyUiSkin,
  type ReadyUiThemeOverrides
} from 'game-core/pixi';
import { createShowcaseLocalization } from './localizationDemo';

const SCREENS = [
  { id: 'map', label: 'HUD + LevelMap' },
  { id: 'settings-map', label: 'Settings (map)' },
  { id: 'settings-level', label: 'Settings (in level)' },
  { id: 'restart', label: 'Confirm Restart' },
  { id: 'restart-offer', label: 'Confirm Restart + OFFER' },
  { id: 'exit', label: 'Confirm Exit' },
  { id: 'lives-minimal', label: 'Lives — minimal' },
  { id: 'lives', label: 'Lives — REFILL + GET' },
  { id: 'lives-full', label: 'Lives — full (REFILL + GET + OFFER)' },
  { id: 'win', label: 'Result WIN' },
  { id: 'fail', label: 'Result FAIL' }
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
(document.getElementById('toggle') as HTMLButtonElement).addEventListener('click', () => bar.classList.toggle('hidden'));

// --- the host: one Pixi app, the Core runtimes, the host clock ---
const resolution = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
const app = new Application();
await app.init({ resizeTo: window, resolution, autoDensity: true, antialias: true, backgroundAlpha: 0 });
document.body.insertBefore(app.canvas, bar);
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
type Insets = { top: number; right: number; bottom: number; left: number };
let screen: { resize(w: number, h: number, o: { insets: Insets; pixelRatio: number }): void };
let hud: HudView;
if (styleNo === 2) {
  const mapScreen = new LevelMapScreen({
    ...base, id: 'map-screen',
    map: { levels, currentLevel: CURRENT, onSelectLevel: (level) => log(`level:${level}`), onLockedTap: (level) => log(`locked:${level}`) },
    hud: { coins: 9990, lives: 3, maxLives: 5, stars: 9990, onLivesTap: () => go({ screen: 'lives-full' }), onCoinsTap: () => log('hud:coins') },
    nav: {
      items: [{ id: 'shop', icon: 'iconShop', label: 'SHOP' }, { id: 'home', icon: 'iconHome', label: 'HOME' }, { id: 'events', label: 'EVENTS', locked: true }],
      selectedId: 'home',
      onSelect: (id) => { log(`nav:${id}`); mapScreen.nav.setSelected(id); },
      onLockedTap: (id) => log(`nav-locked:${id}`)
    },
    onPlay: (level) => log(`play:${level}`)
  });
  hud = mapScreen.hud;
  screen = mapScreen;
  app.stage.addChild(mapScreen);
} else {
  // Style 1 covers HUD + LevelMap (no bottom nav / LevelMapScreen): the host composes the two, the map under the HUD row
  const map = new LevelMapView({ ...base, id: 'map', levels, currentLevel: CURRENT, onSelectLevel: (level) => log(`level:${level}`), onLockedTap: (level) => log(`locked:${level}`) });
  const styleHud = new HudView({
    ...base, id: 'hud', coins: 12450, lives: 3, maxLives: 5,
    onLivesTap: () => go({ screen: 'lives-full' }), onCoinsTap: () => log('hud:coins'), onSettingsTap: () => go({ screen: 'settings-map' })
  });
  hud = styleHud;
  screen = {
    resize: (w, h, o) => {
      styleHud.resize(w, h, o);
      map.resize(w, h, { insets: { ...o.insets, top: styleHud.barHeight }, pixelRatio: o.pixelRatio });
    }
  };
  app.stage.addChild(map, styleHud);
}
hud.setLives(3, formatTimer(refillSeconds));

// --- the window of this screen ---
const offerLives: ReadyUiOffer = { icon: 'offerLivesArt', iconLabel: '35d', items: [{ icon: lamp, label: '5' }, { icon: wand, label: '10' }], price: 900, badge: 'x3' };
const offerCoins: ReadyUiOffer = { icon: 'offerCoinArt', iconLabel: '2000', items: [{ icon: lamp, label: '5' }, { icon: wand, label: '10' }], price: 900, badge: 'x3' };
let view: ModalWindow<never> | null = null;
let open: () => void = () => {};
const onDismiss = (reason: string): void => log(`dismiss:${reason}`);
switch (screenId) {
  case 'settings-map':
  case 'settings-level': {
    const inLevel = screenId === 'settings-level';
    const settings = new SettingsWindowView({
      ...base, id: 'settings', haptic: styleNo === 1, onDismiss,
      onToggle: (setting, enabled) => log(`toggle:${setting}:${enabled}`),
      ...(inLevel ? { onHome: () => log('settings:home'), onRestart: () => log('settings:restart') } : {})
    });
    open = () => settings.show({ sound: true, music: false, haptic: true, version: 'VERSION 1.0.0 (1)', gameButtons: inLevel });
    view = settings as unknown as ModalWindow<never>;
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
  const window = screenId.startsWith('settings') ? 'settings' : screenId.startsWith('lives') ? 'lives' : screenId === 'win' || screenId === 'fail' ? 'result' : screenId === 'map' ? 'levelMap' : 'confirm';
  const covered = skin.covers.includes(window as never);
  return `Style ${styleNo} · ${SCREENS.find((s) => s.id === screenId)?.label}: ${covered ? 'style art' : 'NOT in this style — donor look'}`;
}
note.textContent = coverage();

// --- layout + clock ---
const readSafe = () => {
  const probe = document.getElementById('safe-probe');
  const style = probe ? getComputedStyle(probe) : null;
  const px = (value: string | undefined) => Math.max(0, parseFloat(value ?? '') || 0);
  return { top: px(style?.paddingTop), right: px(style?.paddingRight), bottom: px(style?.paddingBottom), left: px(style?.paddingLeft) };
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
