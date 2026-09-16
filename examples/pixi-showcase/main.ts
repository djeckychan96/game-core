// GAME CORE UI SHOWCASE — a standalone page that shows the Pixi Ready UI kit shipped inside
// game-core, with no game attached. The host (this file) owns the Pixi Application and ticker;
// the kit is driven only through `core.update(deltaMS)`.
//
// Production Ready UI on screen: HUD (lives / coins / stars / settings), the level map, the PLAY
// button, the two offer icons, and every window. The thin strip at the very bottom is a DEMO
// TOOLBAR (opens each window directly) and is deliberately styled unlike the game UI.
import { Application, Container, type FederatedPointerEvent, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { BUILD_INFO, CoreRuntime, MotionRuntime, UiRuntime } from 'game-core';
import {
  ClickRippleEffect,
  DEFAULT_CLICK_RIPPLE,
  HudView,
  LevelMapView,
  LivesWindowView,
  NoAdsWindowView,
  ResultWindowView,
  SettingsWindowView,
  ShopWindowView,
  StarterPackWindowView,
  UiButton,
  createLabel,
  formatTimer,
  loadReadyUiAssets,
  resolveTheme,
  type ClickRippleConfig,
  type ReadyUiTextures
} from 'game-core/pixi';
import { DEMO_MAX_LIVES, DEMO_REFILL_PRICE, DEMO_SHOP_ITEMS, createDemoState } from './demoData';

interface SafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function readSafeInsets(): SafeInsets {
  const probe = document.getElementById('safe-probe');
  if (!probe) return { top: 0, right: 0, bottom: 0, left: 0 };
  const style = getComputedStyle(probe);
  const px = (value: string) => Math.max(0, parseFloat(value) || 0);
  return { top: px(style.paddingTop), right: px(style.paddingRight), bottom: px(style.paddingBottom), left: px(style.paddingLeft) };
}

/** Donor main screen: PLAY is 522 × 228 design units at 1.424 × the contain scale on a phone. */
const PLAY_SCALE = 1.424;
const PLAY_BOTTOM_RATIO = 98 / 844;
const TOOLBAR_H = 30;
/** The donor's pan threshold: a finger that travelled further panned/scrolled, it did not tap. */
const EMPTY_TAP_THRESHOLD_PX = 12;

/**
 * The ripple pill cycles these. Index 0 is the production ocean — `DEFAULT_CLICK_RIPPLE`, 1:1 with
 * Trail Arrow's `ArrowRenderer.spawnOceanRipple`. The halo variant only demonstrates the Core-only
 * option for light backgrounds; a game configures the effect once and keeps it.
 */
const RIPPLE_PRESETS: Array<{ name: string; config: Partial<ClickRippleConfig> | null }> = [
  { name: 'OCEAN · Trail Arrow production', config: {} },
  { name: 'OCEAN + HALO · demo for light backgrounds', config: { haloAlpha: 0.35 } },
  { name: 'RIPPLE · OFF', config: null }
];

async function boot(): Promise<void> {
  const theme = resolveTheme();
  const app = new Application();
  const resolution = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
  await app.init({
    resizeTo: window,
    resolution,
    autoDensity: true,
    antialias: true,
    background: theme.colors.mapBackground,
    powerPreference: 'high-performance'
  });
  document.getElementById('app')!.appendChild(app.canvas);
  app.canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  // --- Game Core foundation: one clock (the Pixi ticker), one cancellation tree ---
  const core = new CoreRuntime();
  const motion = new MotionRuntime();
  const ui = new UiRuntime({ motion });
  core.registerRuntime('ui', ui);
  core.registerRuntime('motion', motion);
  let tickTimers: (deltaMs: number) => void = () => {};
  app.ticker.add((ticker) => {
    core.update(ticker.deltaMS);
    tickTimers(ticker.deltaMS);
  });

  const textures: ReadyUiTextures = await loadReadyUiAssets({ baseUrl: './pixi-ui/' });
  document.getElementById('boot')?.remove();

  const state = createDemoState();
  const settings = { sound: true, music: true };
  const totalStars = () => state.levels.reduce((sum, level) => sum + (level.stars ?? 0), 0);
  const screen = new Container();
  const modals = new Container();
  // Click ripple (Game Core Pixi FX): rings draw over the game screen and under the modals. The
  // effect only draws; which pointer-up counts as "a tap on empty space" is decided below (host).
  const ripple = new ClickRippleEffect({ motion, id: 'showcase' });
  app.stage.addChild(screen, ripple, modals);

  // --- windows (created once, shown on demand) ---
  const resultWindow = new ResultWindowView({
    ui, motion, textures,
    onNext: (params) => {
      // demo progression: a win on the current level unlocks the next one
      const level = state.levels[params.level - 1];
      if (level) level.stars = Math.max(level.stars ?? 0, params.stars ?? 0);
      if (params.level === state.currentLevel && state.currentLevel < state.levels.length) state.currentLevel += 1;
      state.coins += params.rewardCoins;
      hud.setCoins(state.coins);
      hud.setStars(totalStars());
      map.setProgress({ levels: state.levels, currentLevel: state.currentLevel });
      map.scrollToLevel(state.currentLevel);
    },
    onRetry: (params) => openResult(params.level)
  });
  const shopWindow = new ShopWindowView({
    ui, motion, textures,
    onBuy: (item) => { state.coins += item.amount; hud.setCoins(state.coins); }
  });
  const livesWindow = new LivesWindowView({
    ui, motion, textures,
    onRefill: (params) => {
      if (state.coins < params.refillPrice) return openShop();
      state.coins -= params.refillPrice;
      state.lives = DEMO_MAX_LIVES;
      hud.setCoins(state.coins);
      hud.setLives(state.lives, formatTimer(state.refillSeconds));
    },
    onWatchAd: () => { state.lives = Math.min(DEMO_MAX_LIVES, state.lives + 1); hud.setLives(state.lives, formatTimer(state.refillSeconds)); }
  });
  const settingsWindow = new SettingsWindowView({
    ui, motion, textures,
    onToggle: (setting, enabled) => { if (setting === 'sound' || setting === 'music') settings[setting] = enabled; }
  });
  const noAdsWindow = new NoAdsWindowView({ ui, motion, textures, onBuy: () => toast('NO ADS — purchase is the host\'s job') });
  const starterWindow = new StarterPackWindowView({
    ui, motion, textures,
    onBuy: (params) => { state.coins += params.rewards.coins; hud.setCoins(state.coins); toast('STARTER PACK — purchase is the host\'s job'); }
  });
  modals.addChild(resultWindow, shopWindow, livesWindow, settingsWindow, noAdsWindow, starterWindow);

  const openResult = (level: number) => {
    const won = state.levels[level - 1];
    const stars = 1 + ((level * 7) % 3); // deterministic demo stars 1..3
    resultWindow.show({ level, stars, rewardCoins: 40 + (level % 5) * 15, retry: (won?.stars ?? 0) > 0 || level < state.currentLevel });
  };
  const openShop = () => shopWindow.show({ items: DEMO_SHOP_ITEMS });
  const openLives = () => livesWindow.show({ lives: state.lives, maxLives: DEMO_MAX_LIVES, timerText: formatTimer(state.refillSeconds), refillPrice: DEMO_REFILL_PRICE });
  const openSettings = () => settingsWindow.show({ ...settings, version: `VERSION ${BUILD_INFO.version}` });
  const openNoAds = () => noAdsWindow.show({ price: '$1.99' });
  const openStarter = () => starterWindow.show({ price: '$0.99', rewards: { coins: 3500, infiniteLives: '1h', boosters: 'x3' } });

  // --- HUD ---
  const hud = new HudView({
    ui, motion, textures,
    coins: state.coins,
    lives: state.lives,
    maxLives: DEMO_MAX_LIVES,
    stars: totalStars(),
    onCoinsTap: openShop,
    onLivesTap: openLives,
    onSettingsTap: openSettings
  });
  hud.setLives(state.lives, formatTimer(state.refillSeconds));

  // --- Level map ---
  const map = new LevelMapView({
    ui, motion, textures,
    levels: state.levels,
    currentLevel: state.currentLevel,
    onSelectLevel: (level) => { if (state.lives <= 0) return openLives(); openResult(level); },
    onLockedTap: (level) => toast(`LEVEL ${level} IS LOCKED`),
    onFocusChange: ({ selectedLevel }) => playSub.text = `Level ${selectedLevel}`
  });

  // --- PLAY (donor: big green button under the map, "PLAY" + "Level N") ---
  const playButton = new UiButton({
    ui, id: 'showcase:play', theme, texture: textures.btnPlay, width: 522, height: 228,
    label: 'PLAY', fontSize: 110, labelOffsetY: -34, pressScale: 0.9,
    onTap: () => { if (state.lives <= 0) return openLives(); openResult(map.selectedLevel); }
  });
  if (playButton.labelText) playButton.labelText.style.stroke = { color: 0x000000, width: 10, join: 'round' };
  const playSub = createLabel(theme, `Level ${map.selectedLevel}`, { fontSize: 44, stroke: 5, fill: theme.colors.textMuted });
  playSub.y = 40;
  playButton.addChild(playSub);

  // --- offer icons on the map (donor: starter pack left, no ads right, at a quarter height) ---
  const starterIcon = new UiButton({ ui, id: 'showcase:offer-starter', theme, texture: textures.starterIcon, width: 100, height: 100, pressScale: 0.9, onTap: openStarter });
  const noAdsIcon = new UiButton({ ui, id: 'showcase:offer-noads', theme, texture: textures.noAdsIcon, width: 100, height: 100, pressScale: 0.9, onTap: openNoAds });

  // --- DEMO TOOLBAR (not part of the Ready UI): flat dark strip with tiny pills ---
  const toolbar = new Container();
  const toolbarBg = new Graphics();
  toolbarBg.eventMode = 'static'; // the strip is UI: a tap on it is consumed, never a ripple
  toolbar.addChild(toolbarBg);
  let ripplePreset = 0;
  const setRipplePreset = (index: number) => {
    ripplePreset = ((index % RIPPLE_PRESETS.length) + RIPPLE_PRESETS.length) % RIPPLE_PRESETS.length;
    const preset = RIPPLE_PRESETS[ripplePreset]!;
    if (preset.config) ripple.configure({ ...DEFAULT_CLICK_RIPPLE, ...preset.config });
    else ripple.cancelAll();
    toast(preset.name);
  };
  const toolbarItems: Array<[string, () => void]> = [
    ['RESULT', () => openResult(map.selectedLevel)], ['SHOP', openShop], ['LIVES', openLives],
    ['SETTINGS', openSettings], ['NO ADS', openNoAds], ['OFFER', openStarter],
    ['RIPPLE', () => setRipplePreset(ripplePreset + 1)]
  ];
  const pills = toolbarItems.map(([label, onTap], i) => {
    const pill = new UiButton({ ui, id: `showcase:toolbar:${i}`, theme, texture: Texture.WHITE, width: 56, height: 20, label, fontSize: 9, labelOffsetY: 0, pressScale: 0.9, onTap });
    pill.background.tint = 0x3a4160;
    pill.background.alpha = 0.9;
    if (pill.labelText) { pill.labelText.style.stroke = { color: 0x000000, width: 0 }; pill.labelText.style.fill = 0xdfe6ff; }
    toolbar.addChild(pill);
    return pill;
  });
  const caption = createLabel(theme, `DEMO · game-core ${BUILD_INFO.version}`, { fontSize: 8, stroke: false, fill: 0x9aa3c7 });
  toolbar.addChild(caption);

  screen.addChild(map, hud, starterIcon, noAdsIcon, playButton, toolbar);

  // --- toast (a MotionRuntime-driven label, no timers) ---
  let toastLabel: Text | null = null;
  const toast = (message: string) => {
    motion.cancelScope('showcase:toast');
    toastLabel?.destroy();
    toastLabel = createLabel(theme, message, { fontSize: 15, stroke: 3 });
    toastLabel.position.set(app.screen.width / 2, hud.barHeight + 24);
    toastLabel.alpha = 0;
    screen.addChild(toastLabel);
    const label = toastLabel;
    motion.sequence({
      scope: 'showcase:toast',
      steps: [
        { type: 'tween', bindings: [{ get: () => label.alpha, set: (v) => { label.alpha = v; }, to: 1 }], durationMs: 160 },
        { type: 'delay', durationMs: 1400 },
        { type: 'tween', bindings: [{ get: () => label.alpha, set: (v) => { label.alpha = v; }, to: 0 }], durationMs: 300 }
      ],
      onComplete: () => { if (toastLabel === label) { label.destroy(); toastLabel = null; } }
    });
  };

  // --- empty-tap gate: HOST policy, deliberately not in Core ---
  // A pointer-down counts only if it lands on a free surface (the stage background or the map's
  // empty ribbon — never a button, a badge, a window, the toolbar), while no window is blocking,
  // and the matching pointer-up did not travel past the donor's 12 px pan threshold (a map scroll
  // is not a tap). Core knows none of this. Trail Arrow's own gate lives in its ArrowRenderer:
  // pinch/pan state, `arrowAtLoose` (a tap near an arrow is an arrow tap, never a ripple) — all
  // game-specific, so a game brings its own conditions here in the same way.
  app.stage.eventMode = 'static';
  app.stage.hitArea = app.screen; // empty space now hits the stage instead of nothing
  const freeSurfaces = new Set<unknown>([app.stage, map]);
  let emptyPress: { pointerId: number; x: number; y: number } | null = null;
  app.stage.on('pointerdown', (event: FederatedPointerEvent) => {
    emptyPress = null;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (ui.isBlocking() || !freeSurfaces.has(event.target)) return;
    emptyPress = { pointerId: event.pointerId, x: event.global.x, y: event.global.y };
  });
  app.stage.on('pointerup', (event: FederatedPointerEvent) => {
    const press = emptyPress;
    emptyPress = null;
    if (!press || press.pointerId !== event.pointerId) return;
    if (Math.hypot(event.global.x - press.x, event.global.y - press.y) > EMPTY_TAP_THRESHOLD_PX) return;
    if (RIPPLE_PRESETS[ripplePreset]!.config === null) return;
    ripple.spawnGlobal(event.global.x, event.global.y);
  });
  app.stage.on('pointercancel', () => { emptyPress = null; });

  // --- layout ---
  const layout = () => {
    const w = app.screen.width;
    const h = app.screen.height;
    const safe = readSafeInsets();
    const s = Math.min(w / theme.designWidth, h / theme.designHeight);

    hud.resize(w, h, { insets: { top: safe.top, left: safe.left, right: safe.right }, pixelRatio: resolution });
    // the ripple is NOT scaled with the UI: like the donor it is a fixed size in screen px everywhere

    // demo toolbar: inside the bottom safe area, PLAY clears it
    const toolbarTop = h - safe.bottom - TOOLBAR_H;
    toolbarBg.clear().rect(0, toolbarTop - 4, w, TOOLBAR_H + 4 + safe.bottom).fill({ color: 0x080a12, alpha: 0.78 });
    const pillGap = 4;
    const pillW = Math.min(56, (w - 16 - pillGap * (pills.length - 1)) / pills.length);
    const pillScale = pillW / 56;
    const rowW = pills.length * pillW + (pills.length - 1) * pillGap;
    pills.forEach((pill, i) => {
      pill.setIdleScale(pillScale);
      pill.position.set(w / 2 - rowW / 2 + pillW / 2 + i * (pillW + pillGap), toolbarTop + TOOLBAR_H / 2 - 2);
    });
    caption.position.set(w / 2, toolbarTop + TOOLBAR_H - 1);
    caption.visible = safe.bottom > 6;

    // PLAY: donor size and its 98/844 bottom margin, never under the toolbar
    const playScale = Math.min(PLAY_SCALE * s, (w - 40) / 522);
    const playH = 228 * playScale;
    const playBottom = Math.min(h - h * PLAY_BOTTOM_RATIO, toolbarTop - 12);
    playButton.setIdleScale(playScale);
    playButton.position.set(w / 2, playBottom - playH / 2);
    const playTop = playBottom - playH;

    // offer icons: 16% of the short side (64..120 px), 10 px from the edges, a quarter down
    const iconSize = Math.max(64, Math.min(120, Math.min(w, h) * 0.16));
    starterIcon.setIdleScale(iconSize / 100);
    noAdsIcon.setIdleScale(iconSize / 100);
    starterIcon.position.set(safe.left + 10 + iconSize / 2, h / 4);
    noAdsIcon.position.set(w - safe.right - 10 - iconSize / 2, h / 4);

    // the map runs from under the HUD to the top of PLAY (nodes slide under the button)
    map.resize(w, h, { insets: { top: hud.barHeight - 10 * s, bottom: h - playTop - 8 * s, left: safe.left, right: safe.right }, pixelRatio: resolution });

    const modalInsets = { top: safe.top, bottom: safe.bottom, left: safe.left, right: safe.right };
    for (const win of [resultWindow, shopWindow, livesWindow, settingsWindow, noAdsWindow, starterWindow]) {
      win.resize(w, h, { insets: modalInsets, pixelRatio: resolution });
    }
    if (toastLabel) toastLabel.position.set(w / 2, hud.barHeight + 24);
  };
  app.renderer.on('resize', layout);
  layout();
  // iOS reports safe-area/orientation a frame late
  window.addEventListener('orientationchange', () => setTimeout(layout, 60));

  // --- demo timers driven by the host ticker (lives refill countdown) ---
  let timerAcc = 0;
  tickTimers = (deltaMs: number): void => {
    timerAcc += deltaMs;
    while (timerAcc >= 1000) {
      timerAcc -= 1000;
      if (state.lives < DEMO_MAX_LIVES) {
        state.refillSeconds -= 1;
        if (state.refillSeconds <= 0) {
          state.refillSeconds = 30 * 60;
          state.lives += 1;
          hud.setLives(state.lives, formatTimer(state.refillSeconds));
        } else {
          hud.setLivesTimer(formatTimer(state.refillSeconds));
        }
        livesWindow.setTimer(formatTimer(state.refillSeconds));
      }
    }
  };

  // dev hooks for automated visual checks (Playwright)
  (window as unknown as { __showcase: unknown }).__showcase = {
    app, core, ui, motion, map, hud, state,
    resultWindow, shopWindow, livesWindow, settingsWindow, noAdsWindow, starterWindow,
    playButton, toolbar,
    ripple, ripplePresets: RIPPLE_PRESETS, setRipplePreset,
    openResult, openShop, openLives, openSettings, openNoAds, openStarter,
    layout,
    stats: () => core.getStats()
  };
}

boot().catch((error) => {
  console.error('[showcase] boot failed', error);
  const boot = document.getElementById('boot');
  if (boot) boot.textContent = `BOOT FAILED: ${String((error as Error)?.message ?? error)}`;
});
