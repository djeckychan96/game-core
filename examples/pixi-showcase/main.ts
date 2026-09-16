// GAME CORE UI SHOWCASE — a standalone page that shows the Pixi Ready UI kit shipped inside
// game-core, with no game attached. The host (this file) owns the Pixi Application and ticker;
// the kit is driven only through `core.update(deltaMS)`.
import { Application, Container, Sprite, Text } from 'pixi.js';
import { BUILD_INFO, CoreRuntime, MotionRuntime, UiRuntime } from 'game-core';
import {
  HudView,
  LevelMapView,
  LivesWindowView,
  ResultWindowView,
  ShopWindowView,
  UiButton,
  createLabel,
  formatTimer,
  loadReadyUiAssets,
  resolveTheme,
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
  return {
    top: px(style.paddingTop),
    right: px(style.paddingRight),
    bottom: px(style.paddingBottom),
    left: px(style.paddingLeft)
  };
}

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
  const screen = new Container();
  const modals = new Container();
  app.stage.addChild(screen, modals);

  // --- windows (created once, shown on demand) ---
  const resultWindow = new ResultWindowView({
    ui,
    motion,
    textures,
    onNext: (params) => {
      // demo progression: a win on the current level unlocks the next one
      const level = state.levels[params.level - 1];
      if (level) level.stars = Math.max(level.stars ?? 0, params.stars);
      if (params.level === state.currentLevel && state.currentLevel < state.levels.length) {
        state.currentLevel += 1;
      }
      state.coins += params.rewardCoins;
      hud.setCoins(state.coins);
      map.setProgress({ levels: state.levels, currentLevel: state.currentLevel });
      map.scrollToLevel(state.currentLevel);
    },
    onRetry: (params) => openResult(params.level)
  });
  const shopWindow = new ShopWindowView({
    ui,
    motion,
    textures,
    onBuy: (item) => {
      state.coins += item.amount;
      hud.setCoins(state.coins);
    }
  });
  const livesWindow = new LivesWindowView({
    ui,
    motion,
    textures,
    onRefill: (params) => {
      if (state.coins < params.refillPrice) return openShop();
      state.coins -= params.refillPrice;
      state.lives = DEMO_MAX_LIVES;
      hud.setCoins(state.coins);
      hud.setLives(state.lives, formatTimer(state.refillSeconds));
    },
    onWatchAd: () => {
      state.lives = Math.min(DEMO_MAX_LIVES, state.lives + 1);
      hud.setLives(state.lives, formatTimer(state.refillSeconds));
    }
  });
  modals.addChild(resultWindow, shopWindow, livesWindow);

  const openResult = (level: number) => {
    const won = state.levels[level - 1];
    const stars = 1 + ((level * 7) % 3); // deterministic demo stars 1..3
    resultWindow.show({ level, stars, rewardCoins: 40 + (level % 5) * 15, retry: (won?.stars ?? 0) > 0 || level < state.currentLevel });
  };
  const openShop = () => shopWindow.show({ items: DEMO_SHOP_ITEMS });
  const openLives = () =>
    livesWindow.show({
      lives: state.lives,
      maxLives: DEMO_MAX_LIVES,
      timerText: formatTimer(state.refillSeconds),
      refillPrice: DEMO_REFILL_PRICE
    });

  // --- HUD ---
  const hud = new HudView({
    ui,
    motion,
    textures,
    coins: state.coins,
    lives: state.lives,
    maxLives: DEMO_MAX_LIVES,
    onCoinsTap: openShop,
    onLivesTap: openLives,
    onSettingsTap: () => toast('SETTINGS — not part of this showcase')
  });
  hud.setLives(state.lives, formatTimer(state.refillSeconds));

  // --- Level map ---
  const map = new LevelMapView({
    ui,
    motion,
    textures,
    levels: state.levels,
    currentLevel: state.currentLevel,
    onSelectLevel: (level) => {
      if (state.lives <= 0) return openLives();
      openResult(level);
    },
    onLockedTap: (level) => toast(`LEVEL ${level} IS LOCKED`),
    onFocusChange: ({ selectedLevel }) => playButton.setLabel(`LEVEL ${selectedLevel}`)
  });

  // --- bottom bar: PLAY + demo window buttons ---
  const bottomBar = new Container();
  const bottomShade = new Sprite(textures.topShadow);
  bottomShade.anchor.set(0.5, 1);
  bottomShade.scale.y = -1;
  bottomShade.eventMode = 'none';
  bottomShade.tint = 0x0a0d18;
  bottomShade.alpha = 0.85;
  bottomBar.addChild(bottomShade);

  const playButton = new UiButton({
    ui,
    id: 'showcase:play',
    theme,
    texture: textures.btnPlay,
    width: 522,
    height: 228,
    label: `LEVEL ${map.selectedLevel}`,
    fontSize: 78,
    labelOffsetY: -8,
    onTap: () => {
      if (state.lives <= 0) return openLives();
      openResult(map.selectedLevel);
    }
  });
  const playCaption = createLabel(theme, 'PLAY', { fontSize: 44, stroke: 5 });
  playCaption.y = 62;
  playButton.addChild(playCaption);

  const demoButtons = [
    new UiButton({ ui, id: 'showcase:result', theme, texture: textures.btnGreen, width: 439, height: 207, label: 'RESULT', fontSize: 64, onTap: () => openResult(map.selectedLevel) }),
    new UiButton({ ui, id: 'showcase:shop', theme, texture: textures.btnYellow, width: 439, height: 207, label: 'SHOP', fontSize: 64, onTap: openShop }),
    new UiButton({ ui, id: 'showcase:lives', theme, texture: textures.btnGreenShort, width: 439, height: 207, label: 'LIVES', fontSize: 64, onTap: openLives })
  ];
  bottomBar.addChild(playButton, ...demoButtons);
  const caption = createLabel(theme, `GAME CORE · PIXI READY UI · core ${BUILD_INFO.version}`, { fontSize: 10, stroke: false, fill: theme.colors.textMuted });
  caption.alpha = 0.55;
  bottomBar.addChild(caption);

  screen.addChild(map, hud, bottomBar);

  // --- toast (a MotionRuntime-driven label, no timers) ---
  let toastLabel: Text | null = null;
  const toast = (message: string) => {
    motion.cancelScope('showcase:toast');
    toastLabel?.destroy();
    toastLabel = createLabel(theme, message, { fontSize: 15 });
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

  // --- layout ---
  let bottomBarHeight = 0;
  const layout = () => {
    const w = app.screen.width;
    const h = app.screen.height;
    const safe = readSafeInsets();
    const s = Math.min(w / theme.designWidth, h / theme.designHeight);

    hud.resize(w, h, { insets: { top: safe.top, left: safe.left, right: safe.right }, pixelRatio: resolution });

    // bottom bar: PLAY row + demo row, sized in design units × contain scale
    const playScale = Math.min(s * 0.9, (w - safe.left - safe.right - 40) / 522);
    const playH = 228 * playScale;
    const rowGap = 8;
    const smallH = Math.max(36, Math.min(48, h * 0.056));
    const smallW = Math.min(140, (w - safe.left - safe.right - 16 * 4) / 3);
    const smallScale = Math.min(smallW / 439, smallH / 207);
    const captionH = 14;
    const bottomPad = Math.max(8, safe.bottom);
    bottomBarHeight = bottomPad + captionH + 207 * smallScale + rowGap + playH + 8;
    const baseY = h - bottomPad - captionH;
    caption.position.set(w / 2, h - bottomPad - 5);
    playButton.setIdleScale(playScale);
    playButton.position.set(w / 2, baseY - 207 * smallScale - rowGap - playH / 2);
    const rowW = demoButtons.length * 439 * smallScale + (demoButtons.length - 1) * 12;
    demoButtons.forEach((button, i) => {
      button.setIdleScale(smallScale);
      button.position.set(w / 2 - rowW / 2 + 439 * smallScale / 2 + i * (439 * smallScale + 12), baseY - 207 * smallScale / 2);
    });
    bottomShade.width = w * 1.1;
    bottomShade.height = bottomBarHeight * 1.7;
    bottomShade.position.set(w / 2, h);

    map.resize(w, h, {
      insets: { top: hud.barHeight - 10 * s, bottom: bottomBarHeight - 16, left: safe.left, right: safe.right },
      pixelRatio: resolution
    });
    const modalInsets = { top: safe.top, bottom: safe.bottom, left: safe.left, right: safe.right };
    resultWindow.resize(w, h, { insets: modalInsets, pixelRatio: resolution });
    shopWindow.resize(w, h, { insets: modalInsets, pixelRatio: resolution });
    livesWindow.resize(w, h, { insets: modalInsets, pixelRatio: resolution });
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
    app,
    core,
    ui,
    motion,
    map,
    hud,
    resultWindow,
    shopWindow,
    livesWindow,
    state,
    openResult,
    openShop,
    openLives,
    layout,
    stats: () => core.getStats()
  };
}

boot().catch((error) => {
  console.error('[showcase] boot failed', error);
  const boot = document.getElementById('boot');
  if (boot) boot.textContent = `BOOT FAILED: ${String((error as Error)?.message ?? error)}`;
});
