// Public entry of the Game Core Pixi Ready UI kit: `import { ... } from "game-core/pixi"`.
//
// Everything here draws with PixiJS 8 (a peer dependency the host supplies) on top of the
// renderer-agnostic foundation exported from the package root (`UiRuntime`, `MotionRuntime`,
// `CoreRuntime`): every button is a ButtonController, every window a WindowController, every
// animation a MotionRuntime tween. The host owns the Pixi Application and its ticker and drives
// the kit through `core.update(frameMs)`; the kit never creates a ticker or requestAnimationFrame.
export { LevelMapView } from './LevelMapView';
export type {
  LevelMapViewOptions,
  LevelMapLevel,
  LevelMapProgress,
  LevelMapInsets,
  LevelMapResizeOptions,
  LevelMapFocusInfo,
  LevelNodeState
} from './LevelMapView';
export { HudView } from './HudView';
export type { HudViewOptions, HudInsets, HudResizeOptions } from './HudView';
export { UiButton } from './UiButton';
export type { UiButtonOptions } from './UiButton';
export { ModalWindow, backOut } from './ModalWindow';
export type { ModalWindowOptions, ModalInsets, ModalResizeOptions } from './ModalWindow';
export { ResultWindowView } from './ResultWindowView';
export type { ResultWindowParams, ResultWindowViewOptions } from './ResultWindowView';
export { LivesWindowView } from './LivesWindowView';
export type { LivesWindowParams, LivesWindowViewOptions } from './LivesWindowView';
export { ShopWindowView } from './ShopWindowView';
export type { ShopItem, ShopWindowParams, ShopWindowViewOptions } from './ShopWindowView';
export {
  loadReadyUiAssets,
  createReadyUiTextures,
  READY_UI_ASSET_FILES,
  READY_UI_FONT_FILE,
  READY_UI_FONT_FAMILY
} from './assets';
export type { ReadyUiTextures, ReadyUiTextureName, LoadReadyUiAssetsOptions } from './assets';
export { DEFAULT_READY_UI_THEME, resolveTheme } from './theme';
export type { ReadyUiTheme, ReadyUiThemeOverrides, ReadyUiTextTheme, ReadyUiColors, ReadyUiLevelMapTheme } from './theme';
export { createLabel, fitLabelWidth, applyTextResolution, formatAmount, formatTimer } from './text';
export type { LabelOptions } from './text';
