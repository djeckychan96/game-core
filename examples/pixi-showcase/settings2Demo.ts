// Style 2 Settings (Figma theme_light_3, `настройки` 8:17493): the existing SettingsWindowView drawn by READY_UI_STYLE_2,
// driven by the host ticker like a game. Query:
//   ?locale=ru   showcase/manual-QA locale override — production gets it from the ready platform
//   ?figma=1     the Figma frame's sample copy and states (НАСТРОЙКИ, Sound, Music OFF, Restart level, Return home,
//                VERSION X.XX.XXXX (XX)) as explicit host text: the parity capture
//   ?map=1       the map variant (no game buttons)
//   ?sound=0 / ?music=0   start with that setting off
import { Application } from 'pixi.js';
import { CoreRuntime, MotionRuntime, UiRuntime } from 'game-core';
import { READY_UI_STYLE_2, SettingsWindowView, loadReadyUiAssets, type SettingsWindowParams } from 'game-core/pixi';
import { createShowcaseLocalization } from './localizationDemo';

const params = new URLSearchParams(location.search);
const figma = params.has('figma');
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

const textures = await loadReadyUiAssets({ baseUrl: './pixi-ui/', skin: READY_UI_STYLE_2 });
const events: string[] = [];
const sample = figma
  ? { title: 'НАСТРОЙКИ', soundLabel: 'Sound', musicLabel: 'Music', restartLabel: 'Restart level', homeLabel: 'Return home' }
  : {};
const view = new SettingsWindowView({
  ui, motion, textures, i18n, theme: { skin: READY_UI_STYLE_2 }, id: 'settings', ...sample,
  onToggle: (setting, enabled) => events.push(`${setting}:${enabled}`),
  onHome: () => events.push('home'),
  onRestart: () => events.push('restart'),
  onDismiss: (reason) => events.push(`dismiss:${reason}`)
});
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

const state: SettingsWindowParams = {
  sound: params.get('sound') !== '0',
  music: figma ? false : params.get('music') !== '0',
  version: figma ? 'VERSION X.XX.XXXX (XX)' : 'VERSION 0.2.0 (showcase)',
  gameButtons: !params.has('map')
};
let shown = false;
const open = () => {
  const current = view.currentSettings;
  view.show(shown ? { ...state, sound: current.sound, music: current.music } : state);
  shown = true;
};
open();

(window as unknown as { __settings2: unknown }).__settings2 = { app, core, ui, motion, view, events, open, layout, ready: true };
