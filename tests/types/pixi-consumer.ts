// Compile-only fixture (never run): a TypeScript host game takes the shared runtime from `game-core` and the Ready UI
// kit from `game-core/pixi` and hands one to the other with NO cast. scripts/check-pixi-types.mjs compiles it against
// the BUILT package (dist, through package.json "exports") after `npm run build`; under the repo tsconfig it compiles
// against src. Before the kit's declarations named the root's own types, the root's MotionRuntime / UiRuntime were
// "separate declarations of a private property" to the kit, and a host needed
// `{ ui, motion } as unknown as Pick<ModalWindowOptions, 'ui' | 'motion'>` (the Puzzle Style 1 shell).
import {
  CoreRuntime,
  LocalizationRuntime,
  MotionRuntime,
  UiRuntime,
  type ButtonController,
  type EaseFn,
  type LocalizationTextProvider,
  type MotionHandle,
  type WindowController
} from 'game-core';
import {
  ClickRippleEffect,
  ConfirmWindowView,
  HudView,
  LevelMapView,
  READY_UI_CATALOGS,
  SettingsWindowView,
  UiButton,
  backOut,
  resolveTheme,
  type ModalWindowOptions,
  type ReadyUiTextures
} from 'game-core/pixi';

declare const textures: ReadyUiTextures;

const core = new CoreRuntime();
const motion = new MotionRuntime();
const ui = new UiRuntime({ motion });
core.registerRuntime('ui', ui);
core.registerRuntime('motion', motion);
const i18n: LocalizationTextProvider = new LocalizationRuntime({ rawLocale: 'ru', supportedLocales: ['en', 'ru'], defaultLocale: 'en', catalogs: READY_UI_CATALOGS });

// root → kit: the exact shape that needed the cast
const kit: Pick<ModalWindowOptions, 'ui' | 'motion'> = { ui, motion };
const confirm = new ConfirmWindowView({ ...kit, textures, i18n, action: 'restart', onConfirm: () => {} });
const settings = new SettingsWindowView({ ui, motion, textures, i18n, onToggle: () => {}, onRestart: () => {} });
const hud = new HudView({ ui, motion, textures, i18n });
const map = new LevelMapView({ ui, motion, textures, i18n, levels: 30, currentLevel: 1, onSelectLevel: () => {} });
const ripple = new ClickRippleEffect({ motion });
const button = new UiButton({ ui, id: 'play', theme: resolveTheme(), texture: textures.btnClose, onTap: () => {} });

// kit → root: what the kit hands out is the root's own type
const windowController: WindowController = confirm.controller;
const buttonController: ButtonController = button.controller;
const ease: EaseFn = backOut(1.5);
const handle: MotionHandle = motion.delay({ durationMs: 10 });

export const consumer = { core, confirm, settings, hud, map, ripple, windowController, buttonController, ease, handle };
