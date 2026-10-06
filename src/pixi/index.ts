// Public entry of the Game Core Pixi Ready UI kit: `import { ... } from "game-core/pixi"`.
//
// Everything here draws with PixiJS 8 (a peer dependency the host supplies) on top of the
// renderer-agnostic foundation exported from the package root (`UiRuntime`, `MotionRuntime`,
// `CoreRuntime`): every button is a ButtonController, every window a WindowController, every
// animation a MotionRuntime tween. The host owns the Pixi Application and its ticker and drives
// the kit through `core.update(frameMs)`; the kit never creates a ticker or requestAnimationFrame.
// A game that is not drawn with Pixi gets that Application from `createReadyUiOverlay` instead —
// still host-driven (`overlay.update(frameMs)`), still no second frame loop.
export { ReadyUiOverlay, createReadyUiOverlay } from './ReadyUiOverlay';
export type {
  ReadyUiOverlayOptions,
  ReadyUiOverlayInputMode,
  ReadyUiOverlayInsets,
  ReadyUiOverlayLayout,
  ReadyUiOverlayRegion
} from './ReadyUiOverlay';
export { OrientationGuard, createOrientationGuard, ORIENTATION_GUARD_QUERY } from './OrientationGuard';
export type { OrientationGuardOptions, GameOrientation } from './OrientationGuard';
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
export { BottomNavView } from './BottomNavView';
export type { BottomNavItem, BottomNavViewOptions, BottomNavInsets, BottomNavResizeOptions } from './BottomNavView';
export { LevelMapScreen } from './LevelMapScreen';
export type {
  LevelMapScreenOptions,
  LevelMapScreenInsets,
  LevelMapScreenResizeOptions,
  LevelMapScreenNav,
  LevelMapNavSlot,
  LevelMapNavSlotId,
  LevelMapNavSlots
} from './LevelMapScreen';
export { UiButton } from './UiButton';
export type { UiButtonOptions } from './UiButton';
export { ModalWindow, backOut, POP_ENTRANCE, VICTORY_ENTRANCE, CLOSE_SIZE } from './ModalWindow';
export type { ModalWindowOptions, ModalInsets, ModalResizeOptions, ModalFit, ModalEntrance } from './ModalWindow';
export { ResultWindowView, WIN_CONFETTI_TEXTURES } from './ResultWindowView';
export type { ResultWindowParams, ResultWindowViewOptions } from './ResultWindowView';
export { LivesWindowView, LIVES_FIGMA_TEXTURES } from './LivesWindowView';
export type { LivesWindowParams, LivesWindowViewOptions, LivesWindowVariant } from './LivesWindowView';
export { ConfirmWindowView, CONFIRM_EXIT_FIGMA_TEXTURES } from './ConfirmWindowView';
export type { ConfirmWindowParams, ConfirmWindowViewOptions, ConfirmWindowVariant, ConfirmWindowAction } from './ConfirmWindowView';
export type { ReadyUiOffer, ReadyUiOfferArt, ReadyUiOfferItem } from './OfferPanel';
export { ShopWindowView } from './ShopWindowView';
export type { ShopItem, ShopWindowParams, ShopWindowViewOptions } from './ShopWindowView';
export { SettingsWindowView } from './SettingsWindowView';
export type { SettingsLanguage, SettingsState, SettingsWindowParams, SettingsWindowViewOptions } from './SettingsWindowView';
export { NoAdsWindowView } from './NoAdsWindowView';
export type { NoAdsWindowParams, NoAdsWindowViewOptions } from './NoAdsWindowView';
export { StarterPackWindowView } from './StarterPackWindowView';
export type { StarterPackRewards, StarterPackWindowParams, StarterPackWindowViewOptions } from './StarterPackWindowView';
export {
  loadReadyUiAssets,
  createReadyUiTextures,
  READY_UI_ASSET_FILES,
  READY_UI_OPTIONAL_ASSET_FILES,
  READY_UI_NINE_SLICES,
  READY_UI_FONT_FILE,
  READY_UI_FONT_FAMILY
} from './assets';
export type { ReadyUiTextures, ReadyUiTextureName, ReadyUiOptionalTextureName, LoadReadyUiAssetsOptions } from './assets';
export { READY_UI_STYLE_1 } from './skins/style1';
export { READY_UI_STYLE_2 } from './skins/style2';
export { READY_UI_SKINS, READY_UI_SKIN_WINDOW_ROLES, READY_UI_SKIN_VIEW_ROLES, requiredSkinRoles } from './skin';
export type {
  ReadyUiSkin,
  ReadyUiSkinWindow,
  ReadyUiSkinView,
  ReadyUiSkinStandaloneView,
  ReadyUiSkinRole,
  ReadyUiSkinAssetKey,
  ReadyUiSkinWindowAssetKey,
  ReadyUiSkinAsset,
  ReadyUiSkinBox,
  ReadyUiSkinTextBox,
  ReadyUiSkinConfirmLayout,
  ReadyUiSkinWindowText,
  ReadyUiSkinLivesLayout,
  ReadyUiSkinLivesTextBox,
  ReadyUiSkinOfferLayout,
  ReadyUiSkinOfferItemLayout,
  ReadyUiSkinHudLayout,
  ReadyUiSkinLevelMapLayout,
  ReadyUiSkinBottomNavLayout,
  ReadyUiSkinBottomNavItemLayout,
  ReadyUiSkinTextOutline,
  ReadyUiSkinLevelMapScreenLayout,
  ReadyUiSkinIconBox,
  ReadyUiSkinFont,
  ReadyUiSkinLayouts,
  ReadyUiSkinTextures
} from './skin';
export { createNineSlice } from './nineSlice';
export type { NineSliceSpec, NineSliceInsets } from './nineSlice';
export { DEFAULT_READY_UI_THEME, resolveTheme } from './theme';
export type { ReadyUiTheme, ReadyUiThemeOverrides, ReadyUiTextTheme, ReadyUiColors, ReadyUiLevelMapTheme } from './theme';
export { createLabel, fitLabelWidth, applyTextResolution, formatAmount, formatTimer, TEXT_SUPERSAMPLE } from './text';
export type { LabelOptions, FigmaTextLook } from './text';
export { READY_UI_CATALOGS, READY_UI_EN, READY_UI_RU } from './locales';
export { ClickRippleEffect, DEFAULT_CLICK_RIPPLE } from './fx';
export type {
  ClickRippleConfig,
  ClickRippleEffectOptions,
  ClickRippleSpawnOptions,
  ClickRippleHandle,
  ClickRippleStats
} from './fx';
