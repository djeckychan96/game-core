// Style 2 Confirm + Refill Hearts (Figma theme_light_3: `попап рестарт` 8:22049, `попап выйти` 8:22069,
// `screen_refill_hearts` 8:22838): the existing ConfirmWindowView / LivesWindowView drawn by READY_UI_STYLE_2, driven
// by the host ticker like a game. One page, one window at a time. Query:
//   ?window=restart | exit | refill   which window (default restart)
//   ?locale=ru   showcase/manual-QA locale override — production gets it from the ready platform
//   ?figma=1     the Figma frames' sample copy and values as explicit host data (RESTART / EXIT, REFILL NOW, Next heart
//                in, 56 lives, 24:15, 900, the reward "1"): the parity capture
//   ?state=full  Refill at full lives (MAX, REFILL disabled);  ?state=noad  no rewarded offer (REFILL centred)
import { Application } from 'pixi.js';
import { CoreRuntime, MotionRuntime, UiRuntime } from 'game-core';
import { ConfirmWindowView, LivesWindowView, READY_UI_STYLE_2, formatTimer, loadReadyUiAssets, type LivesWindowParams } from 'game-core/pixi';
import { createShowcaseLocalization } from './localizationDemo';

const params = new URLSearchParams(location.search);
const figma = params.has('figma');
const which = params.get('window') === 'exit' ? 'exit' : params.get('window') === 'refill' ? 'refill' : 'restart';
const state = params.get('state');
const i18n = createShowcaseLocalization();
document.documentElement.lang = i18n.locale;

const resolution = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
const app = new Application();
await app.init({ resizeTo: window, resolution, autoDensity: true, antialias: true, backgroundAlpha: 0 });
document.body.appendChild(app.canvas);
const core = new CoreRuntime();
const motion = new MotionRuntime();
const ui = new UiRuntime({ motion });
core.registerRuntime('ui', ui);
core.registerRuntime('motion', motion);
app.ticker.add((ticker) => core.update(ticker.deltaMS));

// the game picks one style: the views read it from the theme, the loader loads its files
const textures = await loadReadyUiAssets({ baseUrl: './pixi-ui/', skin: READY_UI_STYLE_2 });
const theme = { skin: READY_UI_STYLE_2 };
const events: string[] = [];
const onDismiss = (reason: string) => events.push(`dismiss:${reason}`);

let view: ConfirmWindowView | LivesWindowView;
let open: () => void;
if (which === 'refill') {
  const sample = figma ? { title: 'REFILL HEARTS!', nextLifeLabel: 'Next heart in', refillLabel: 'REFILL NOW', adLabel: 'GET', adRewardLabel: '1' } : {};
  const lives = new LivesWindowView({
    ui, motion, textures, i18n, theme, id: 'refill', ...sample,
    // the host refills / shows the rewarded ad; Core only reports the choice (after the close)
    onRefill: (p) => events.push(`refill:${p.lives}/${p.refillPrice}`),
    onWatchAd: (p) => events.push(`ad:${p.lives}`),
    onDismiss
  });
  // runtime values come from the host's LivesRuntime / economy; the countdown ticks through setTimer
  let seconds = 24 * 60 + 15;
  const livesState: LivesWindowParams = state === 'full'
    ? { lives: 5, maxLives: 5, refillPrice: 900 }
    : { lives: figma ? 56 : 2, maxLives: figma ? 99 : 5, timerText: formatTimer(seconds), refillPrice: 900, adOffer: state !== 'noad' };
  open = () => lives.show({ ...livesState, timerText: formatTimer(seconds) });
  if (!figma) {
    let acc = 0;
    app.ticker.add((ticker) => {
      acc += ticker.deltaMS;
      if (acc < 1000) return;
      acc -= 1000;
      seconds = Math.max(0, seconds - 1);
      lives.setTimer(formatTimer(seconds));
    });
  }
  view = lives;
} else {
  const sample = figma ? { title: 'ARE YOU SURE?', body: 'YOU WILL LOSE 1 HEART', confirmLabel: which === 'restart' ? 'RESTART' : 'EXIT' } : {};
  const confirm = new ConfirmWindowView({
    ui, motion, textures, i18n, theme, id: which, action: which, ...sample,
    // the same window for both: the host routes the action (restart the level / leave to the map)
    onConfirm: () => events.push(`confirm:${which}`),
    onDismiss
  });
  open = () => confirm.show();
  view = confirm;
}
app.stage.addChild(view);

const readSafe = () => {
  const probe = document.getElementById('safe-probe');
  const style = probe ? getComputedStyle(probe) : null;
  const px = (value: string | undefined) => Math.max(0, parseFloat(value ?? '') || 0);
  return { top: px(style?.paddingTop), right: px(style?.paddingRight), bottom: px(style?.paddingBottom), left: px(style?.paddingLeft) };
};
const layout = () => view.resize(app.screen.width, app.screen.height, { insets: readSafe(), pixelRatio: resolution });
app.renderer.on('resize', layout);
layout();
open();

(window as unknown as { __windows2: unknown }).__windows2 = { app, core, ui, motion, view, which, events, open, layout, ready: true };
