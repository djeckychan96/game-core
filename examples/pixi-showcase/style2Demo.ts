// Style 2 LevelMap screen (Figma theme_light_3, screen_gameplay_pc 8:23174): the Core LevelMapScreen composition —
// map + background, PLAY, bottom navigation, HUD — chosen once through the game's Ready UI style, driven by the host
// ticker like a game. Target of `npm run showcase:style2` (scripts/style2-level-map-check.mjs). Query:
//   ?locale=ru  showcase/manual-QA locale override — production gets it from the ready platform
//   ?figma=1    the Figma frame's sample values (29:15, 9990, 9990, current = 38): host data for the parity capture
import { Application } from 'pixi.js';
import { CoreRuntime, MotionRuntime, UiRuntime } from 'game-core';
import { LevelMapScreen, READY_UI_STYLE_2, formatTimer, loadReadyUiAssets, type LevelMapLevel, type ReadyUiThemeOverrides } from 'game-core/pixi';
import { createShowcaseLocalization } from './localizationDemo';

const params = new URLSearchParams(location.search);
const figma = params.has('figma');
const i18n = createShowcaseLocalization();
document.documentElement.lang = i18n.locale;

/**
 * The game's Ready UI config: Style 2, plus the map spacing this host takes from the Figma frame (theme.levelMap is
 * the host's: it keeps the shared drag / fling / snap / focus code, only its numbers come from 8:23174). Node art is
 * 288 units, the orange focus node 4/3 of it, centres 1260 / 834 / 456 (one gap of 402 fits both visible gaps best),
 * the focus at 1260 / 2344 of the height, no extra progression scale.
 */
const READY_UI_THEME: ReadyUiThemeOverrides = {
  skin: READY_UI_STYLE_2,
  levelMap: { badgeSize: 288, nodeScale: 1, levelGap: 402, focusBoost: 4 / 3, focusRatio: 1260 / 2344, contentScale: 1 }
};

const resolution = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
const app = new Application();
await app.init({ resizeTo: window, resolution, autoDensity: true, antialias: true, backgroundAlpha: 0 });
document.body.appendChild(app.canvas);
const core = new CoreRuntime();
const motion = new MotionRuntime();
const ui = new UiRuntime({ motion });
core.registerRuntime('ui', ui);
core.registerRuntime('motion', motion);
let tickTimers: (ms: number) => void = () => {};
app.ticker.add((ticker) => {
  core.update(ticker.deltaMS);
  tickTimers(ticker.deltaMS);
});

const textures = await loadReadyUiAssets({ baseUrl: './pixi-ui/', skin: READY_UI_STYLE_2 });

// demo progress: 60 levels, the current one in the middle, completed ones with 0..3 stars, a few hard ones
const CURRENT = 38;
const MAX_LIVES = 5;
const starPattern = [3, 2, 3, 1, 3, 0, 2, 3, 1, 2];
const levels: LevelMapLevel[] = [];
for (let i = 1; i <= 60; i++) {
  const level: LevelMapLevel = { index: i, stars: i < CURRENT ? starPattern[i % starPattern.length] ?? 0 : 0 };
  if (i % 9 === 0) level.hard = true;
  levels.push(level);
}
const state = {
  currentLevel: CURRENT,
  coins: figma ? 9990 : 12450,
  stars: figma ? 9990 : levels.reduce((sum, level) => sum + (level.stars ?? 0), 0),
  lives: 3,
  refillSeconds: figma ? 29 * 60 + 15 : 17 * 60 + 42
};
const events: string[] = [];

const screen = new LevelMapScreen({
  ui, motion, textures, i18n, theme: READY_UI_THEME, id: 'map-screen',
  map: {
    levels,
    currentLevel: state.currentLevel,
    onSelectLevel: (level, nodeState) => events.push(`level:${level}:${nodeState}`),
    onLockedTap: (level) => events.push(`locked-level:${level}`),
    onFocusChange: ({ focusLevel }) => events.push(`focus:${focusLevel}`)
  },
  hud: {
    coins: state.coins,
    lives: state.lives,
    maxLives: MAX_LIVES,
    stars: state.stars,
    onLivesTap: () => events.push('hud:lives'),
    onCoinsTap: () => events.push('hud:coins')
  },
  nav: {
    items: [
      { id: 'shop', icon: 'iconShop', label: 'SHOP' },
      { id: 'home', icon: 'iconHome', label: 'HOME' },
      { id: 'events', label: 'EVENTS', locked: true }
    ],
    selectedId: 'shop',
    // routing is the host's: this demo only records the tap and marks the destination selected
    onSelect: (id) => {
      events.push(`nav:${id}`);
      screen.nav.setSelected(id);
    },
    onLockedTap: (id) => events.push(`nav-locked:${id}`)
  },
  onPlay: (level) => events.push(`play:${level}`)
});
screen.hud.setLives(state.lives, formatTimer(state.refillSeconds));
app.stage.addChild(screen);

const readSafe = () => {
  const probe = document.getElementById('safe-probe');
  const style = probe ? getComputedStyle(probe) : null;
  const px = (value: string | undefined) => Math.max(0, parseFloat(value ?? '') || 0);
  return { top: px(style?.paddingTop), right: px(style?.paddingRight), bottom: px(style?.paddingBottom), left: px(style?.paddingLeft) };
};
const layout = () => screen.resize(app.screen.width, app.screen.height, { insets: readSafe(), pixelRatio: resolution });
app.renderer.on('resize', layout);
layout();

// the lives timer, driven by the host ticker (frozen in the Figma capture)
let acc = 0;
tickTimers = (ms) => {
  if (figma) return;
  acc += ms;
  while (acc >= 1000) {
    acc -= 1000;
    state.refillSeconds = Math.max(0, state.refillSeconds - 1);
    screen.hud.setLivesTimer(formatTimer(state.refillSeconds));
  }
};

(window as unknown as { __style2: unknown }).__style2 = { app, core, ui, motion, screen, events, state, layout, ready: true };
