// Style 1 Result WIN / FAIL (Figma sJ0BV1ARqMpcj5dZbjFppz: `screen/result-win` 1:3854, `screen/result-fail` 1:4029):
// the existing ResultWindowView drawn by READY_UI_STYLE_1, driven by the host ticker like a game. Query:
//   ?outcome=win | fail   which outcome (default win)
//   ?locale=ru   showcase/manual-QA locale override — production gets it from the ready platform
//   ?figma=1     the Figma frames' sample copy and values as explicit host data (LEVEL 200, COMPLETED! / YOU FAILED,
//                500, TRY AGAIN): the parity capture
//   ?stars=0..3  earned stars on a WIN (default 3);  ?exit=0  a fail without the EXIT button;  ?lives=0  no life-lost art
//   ?confetti=1  the WIN fireworks (WIN_CONFETTI_TEXTURES);  ?donor=1  no style: the donor Result (unchanged)
import { Application } from 'pixi.js';
import { CoreRuntime, MotionRuntime, UiRuntime } from 'game-core';
import { READY_UI_STYLE_1, ResultWindowView, WIN_CONFETTI_TEXTURES, loadReadyUiAssets, type ResultWindowParams } from 'game-core/pixi';
import { createShowcaseLocalization } from './localizationDemo';

const params = new URLSearchParams(location.search);
const figma = params.has('figma');
const donor = params.has('donor');
const outcome = params.get('outcome') === 'fail' ? 'fail' : 'win';
const confetti = params.get('confetti') === '1';
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

// the game picks one style: the views read it from the theme, the loader loads its files (+ the confetti art on request)
const textures = await loadReadyUiAssets({ baseUrl: './pixi-ui/', ...(donor ? {} : { skin: READY_UI_STYLE_1 }), ...(confetti ? { include: WIN_CONFETTI_TEXTURES } : {}) });
const events: string[] = [];
const sample = figma ? { nextLabel: 'CONTINUE', retryLabel: outcome === 'fail' ? 'TRY AGAIN' : 'RETRY', rewardsLabel: 'REWARDS' } : {};
const view = new ResultWindowView({
  ui, motion, textures, i18n, id: 'result', ...sample,
  ...(donor ? {} : { theme: { skin: READY_UI_STYLE_1 } }),
  ...(params.get('lives') === '0' ? { lifeDelta: null } : {}),
  ...(confetti ? { confetti: true } : {}),
  // the host navigates; Core only reports the choice (after the close)
  onNext: (p) => events.push(`next:${p.level}`),
  onRetry: (p) => events.push(`retry:${p.outcome ?? 'win'}:${p.level}`),
  ...(params.get('exit') === '0' ? {} : { onExit: (p: ResultWindowParams) => events.push(`exit:${p.level}`) }),
  onDismiss: (reason) => events.push(`dismiss:${reason}`)
});
app.stage.addChild(view);

const stars = Math.max(0, Math.min(3, Number(params.get('stars') ?? 3)));
const show: ResultWindowParams = outcome === 'fail'
  ? { level: figma ? 200 : 12, outcome: 'fail', rewardCoins: 0, ...(figma ? { title: 'LEVEL 200', subtitle: 'YOU FAILED' } : {}) }
  : { level: figma ? 200 : 12, stars, rewardCoins: figma ? 500 : 1250, ...(figma ? { title: 'LEVEL 200', subtitle: 'COMPLETED!' } : {}) };
const open = () => view.show({ ...show });

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

/** Proof helper: advance the host clock deterministically (the star entrance / confetti), then render once. */
const fastForward = (ms: number) => {
  for (let left = ms; left > 0; left -= 16) core.update(Math.min(16, left));
  app.render();
};
(window as unknown as { __result1: unknown }).__result1 = { app, core, ui, motion, view, outcome, events, open, layout, fastForward, ready: true };
