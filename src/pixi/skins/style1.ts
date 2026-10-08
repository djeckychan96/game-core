import type { ReadyUiOptionalTextureName } from '../assets';
import type { ReadyUiSkin, ReadyUiSkinRole } from '../skin';

/**
 * Style 1 — the Figma "HAMSTER PIXEL FLOW" Ready UI.
 *
 * theme_light_4 (file 5FWFwdO4QGeDfeQtloLNOS, section 22:26884, the purple row; docs/figma/style1-theme-light-4) is the
 * current snapshot: Lives 22:27562 (shorter window), the OFFER panel under Lives / Restart (22:28069 / 22:28122),
 * Settings 22:28430 (SETTINGS 100, plain version, violet ×; the windows are one dense column — see `settings`);
 * Exit 22:28232 and WIN 22:28251 are the boxes below unchanged.
 *
 * COVERS: `confirm` (screen/confirm-exit 820:77655, docs/figma/confirm-exit) and `lives` (screen/lives 85:8944,
 * docs/figma/lives), the current runtime surface of `settings`, HUD and LevelMap from the canonical level-select
 * screens (file sJ0BV1ARqMpcj5dZbjFppz, desktop 1:911 / mobile 1:1301), the level `result` WIN / FAIL
 * (screen/result-win 1:3854, screen/result-fail 1:4029, docs/figma/style1-result), and `bottomNav` + `levelMapScreen`
 * — PLAY and the SHOP | HOME | LOCK navigation — from theme_light_5 (section 24:35889, the purple main screen 24:37472
 * and the dark nav components 24:38867 / 24:38858 / 24:38849; docs/figma/theme-light-5-level-map-nav).
 *
 * theme_light_6 (section 28:45250, the DARK row; docs/figma/theme-light-6) is the current snapshot for the Result WIN
 * (28:48286: re-laid and centred, no glow, the black 45 % ×), `moves` (the MOVES box 28:48247), `settingsButton`
 * (the gameplay `btn_settings` 28:48211), `noAds` (`screen_ads_off` 28:48065) and `shopScreen` — the SHOP tab
 * `market_screen_dark` 28:46015 (docs/figma/theme-light-6-shop). NOT COVERED — donor look: the modal ShopWindowView,
 * StarterPack.
 *
 * Every number is the Figma read (unchanged from the `variant: 'figma'` windows): boxes in design units of the
 * 1080 × 2344 frame, art boxes = the SVG export (render) boxes. The files are the ones Core already ships under
 * `assets/pixi-ui/` (rendered by `node scripts/figma-assets.mjs`, no text inside any of them); the 9-slice caps are
 * measured on those rasters: the Figma @stretch insets plus the art's bleed, grown where an effect or a corner reaches
 * into the stretch area, plus an 8-unit gutter at every seam (docs/figma/confirm-exit/README.md lists the numbers).
 */
export const READY_UI_STYLE_1 = {
  id: 'style-1',
  covers: ['confirm', 'lives', 'settings', 'hud', 'levelMap', 'result', 'bottomNav', 'levelMapScreen', 'moves', 'settingsButton', 'noAds', 'shopScreen'],
  frame: { width: 1080, height: 2344 },
  assets: {
    /** `ui/window/base`: the window shell (surface/body + surface/header). @stretch 80 / 175 / 80 / 80 + bleed 4 / 4 / 4 / 8 (bottom: the −23 inner shadow reaches 14 more) + gutter 8. */
    windowSurface: { file: 'window/window_base@2x.webp', nineSlice: { left: 92, top: 187, right: 92, bottom: 110, pad: { left: 4, top: 4, right: 4, bottom: 8 } } },
    /** `action/close`: the close glyph (its 51 × 51 SVG box). */
    windowClose: { file: 'window/window_close@2x.webp' },
    /** `surface/message-card`: the blurred glow behind the Confirm hero art. */
    heroGlow: { file: 'window/message_glow@0.5x.webp' },
    /** `art/broken-heart` (crack included, no "-1": the life delta is runtime text). */
    lifeLostArt: { file: 'icons/broken_heart@2x.webp' },
    /** `ui/button/surface` style=green. @stretch 51 is short of the rounded corners and the shadow (59 / 61 / 59 / 81) + gutter 8. */
    buttonPrimary: { file: 'button/button_green@2x.webp', nineSlice: { left: 67, top: 69, right: 67, bottom: 89 } },
    /** `ui/button/surface` style=orange (the rewarded action): the green geometry, measured 59 / 61 / 59 / 81 + gutter 8. */
    buttonRewarded: { file: 'button/button_orange@2x.webp', nineSlice: { left: 67, top: 69, right: 67, bottom: 89 } },
    /** The button's gold `surface/highlight` gradient (307 × 172), drawn over the rewarded face. */
    buttonHighlight: { file: 'button/button_highlight@2x.webp' },
    /** Lives `section/next-life`: a flat inner panel, no @stretch (a plain 900 × 382 rectangle) — its 50 corners + gutter 8. */
    panelInset: { file: 'window/panel_inset@2x.webp', nineSlice: { left: 58, top: 58, right: 58, bottom: 58 } },
    /** The Lives heart: the broken heart's art without the crack (the count is runtime text). */
    lifeArt: { file: 'icons/lives_heart@2x.webp' },
    /** Coin of a price (100 × 100). */
    priceIcon: { file: 'icons/icon_coin@2x.webp' },
    /** Heart of a reward (154 × 154; its "+1" is runtime text). */
    rewardIcon: { file: 'icons/icon_heart@2x.webp' },
    /** Rewarded-ad clapper (128 × 134, the flattened `icon/reward`). */
    adIcon: { file: 'icons/icon_ad@2x.webp' },
    /** Settings window shell. Its 968 × 1102 export is the 960 × 1090 logical map box plus 4 / 4 / 4 / 8 bleed. */
    settingsPanel: { file: 'settings/panel.webp', nineSlice: { left: 92, top: 187, right: 92, bottom: 110, pad: { left: 4, top: 4, right: 4, bottom: 8 } } },
    /**
     * The Settings language row: Style 1's own `Btn` surface in its blue variant (the toggles' #1564b9 / #2a90ff) — the
     * green / orange button geometry and caps (docs/figma/style1-theme-light-4).
     */
    settingsBtnLanguage: { file: 'button/button_blue@2x.webp', nineSlice: { left: 67, top: 69, right: 67, bottom: 89 } },
    /** Settings close glyph (51 × 51): theme_light_4 22:28868 draws the shell's own violet × (the window's), not the red donor one. */
    settingsClose: { file: 'window/window_close@2x.webp' },
    settingsSound: { file: 'settings/btn_sound.webp' },
    settingsMusic: { file: 'settings/btn_music.webp' },
    settingsHaptic: { file: 'settings/btn_haptic.webp' },
    settingsOff: { file: 'settings/deactivated.webp' },
    settingsBtnHome: { file: 'settings/btn_home.webp' },
    settingsBtnRestart: { file: 'settings/btn_restart.webp' },
    settingsIconRestart: { file: 'settings/icon_restart.webp' },
    /** Exact Figma HUD exports already shipped by the donor pack; Style 1 selects them by semantic role. */
    hudCapsule: { file: 'hud/capsule.webp' },
    hudHeart: { file: 'hud/heart.webp' },
    hudCoin: { file: 'hud/coin.webp' },
    hudPlus: { file: 'hud/plus.webp' },
    hudGear: { file: 'hud/gear.webp' },
    hudGearBack: { file: 'hud/gear_back.webp' },
    /** No Figma completed-state art exists; retain the established rating-star art and semantics. */
    hudStar: { file: 'level/star_gold.webp' },
    levelNodeNormal: { file: 'level/style1_node_blue.webp' },
    levelNodeHard: { file: 'level/style1_node_violet.webp' },
    levelLock: { file: 'level/style1_lock.webp' },
    levelHardBadge: { file: 'level/style1_hard.webp' },
    levelRail: { file: 'level/style1_rail.webp' },
    /**
     * Group 268's transparent export (its 818.6 × 521.6 render bounds at 0.6×), already shipped by the donor pack.
     * The MCP raster of 1:1336 is fully opaque — the screen background baked in — so it is not used.
     */
    levelCurrentGlow: { file: 'level/shine.webp' },
    levelStarGold: { file: 'level/star_gold.webp' },
    levelStarGoldL: { file: 'level/star_gold_l.webp' },
    levelStarGoldR: { file: 'level/star_gold_r.webp' },
    /** Result `ui/ribbon/title` red / grey (1:4024 / 1:4141): back band, both tails, front band — no text (runtime). */
    resultRibbonWin: { file: 'result/style1_ribbon_win@2x.webp' },
    resultRibbonFail: { file: 'result/style1_ribbon_fail@2x.webp' },
    /**
     * theme_light_6 WIN × `icon_close_dark_2` 28:49423 (inside the dark ribbon 28:49231): the same glyph, #000 at 0.45 over
     * the tail (was solid #811d22). The FAIL × stays the grey ribbon's `action/close` (no FAIL in theme_light_6).
     */
    resultCloseWin: { file: 'result/style1_close_dark@2x.webp' },
    resultCloseFail: { file: 'result/style1_close_fail@2x.webp' },
    /** Result FAIL `Rectangle 218`: the blurred band behind the broken heart (its full render box). theme_light_6's WIN has no glow. */
    resultGlowFail: { file: 'result/style1_glow_fail@0.5x.webp' },
    /** Result `icon_coin_128` at 256: the reward coin (render box). */
    rewardCoin: { file: 'result/style1_reward_coin@2x.webp' },
    /** The WIN crown's earned stars: no Figma star in either Style 1 WIN — the kit's upright gold star (the donor crown's file). */
    resultStar: { file: 'level/star_gold.webp' },
    /** Result FAIL EXIT (no Figma node): Style 1's RETURN HOME surface — the gameplay Settings home button art. */
    buttonExit: { file: 'settings/btn_home.webp' },
    /** theme_light_4 OFFER panel (22:28069 / 22:28122): the same `Component 9` window shell at 960 × 640 — the window file and caps. */
    offerPanel: { file: 'window/window_base@2x.webp', nineSlice: { left: 92, top: 187, right: 92, bottom: 110, pad: { left: 4, top: 4, right: 4, bottom: 8 } } },
    /** `icon_sale` 22:28091 without its text: the red burst turned −30° (docs/figma/style1-theme-light-4). */
    offerBadge: { file: 'window/style1_offer_badge@2x.webp' },
    /** `icon_heart` 22:28071 without its caption: the Lives heart with the ∞ glyph (unlimited lives). */
    offerLivesArt: { file: 'icons/style1_offer_lives@2x.webp' },
    /** `icon_coin` 22:28125 without its amount. */
    offerCoinArt: { file: 'icons/style1_offer_coin@2x.webp' },
    /** theme_light_5 PLAY 24:37524 (the green `Group 189`, no text): its 522 × 228 render box (stroke and shadow included). */
    playButton: { file: 'button/style1_play.webp' },
    /**
     * theme_light_5 nav panel 24:37551: the centre columns of its render — 6 rows of the #261a30 stroke over the
     * #303e8f → #222a5d gradient. The gradient runs down the panel, so the middle rows stretch only under a bottom inset.
     */
    navPanel: { file: 'nav/style1_panel.webp', nineSlice: { left: 0, top: 8, right: 0, bottom: 2 } },
    /** `blue_active_dark` 24:38870: the raised column's render without the stroke under it; rows are uniform from 62 (top cap 64). */
    navSelected: { file: 'nav/style1_selected.webp', nineSlice: { left: 60, top: 64, right: 60, bottom: 2 } },
    /** The dark nav icons (288 components, their PNG@1x exports): `icon_lock_dark` 24:38823 is the LOCK slot's art. */
    navLock: { file: 'nav/style1_icon_lock.webp' },
    iconShop: { file: 'nav/style1_icon_shop.webp' },
    iconHome: { file: 'nav/style1_icon_home.webp' },
    /** theme_light_6 dark MOVES 28:48247: `notification_back` 28:48249 at 280 (white, radius 41, a soft ring), no text. */
    movesPanel: { file: 'hud/style1_moves_panel.webp' },
    /** theme_light_6 dark gameplay `btn_settings` 28:48211: the blue `btn` 28:48212 at 214 and `icon_settings_dark` 28:48213. */
    settingsButtonBack: { file: 'hud/style1_settings_button.webp' },
    settingsButtonIcon: { file: 'hud/style1_icon_settings.webp' },
    /**
     * theme_light_6 `screen_ads_off` 28:48065: the purple promo window `Rectangle 66112` 28:48067 (#3b1576, radius 41, a
     * 6-unit ring: the pad) — the same file as the light row's 28:48043 — the rays `pic_decor_2` (shared too), the round
     * close `icon_close_dark` 28:48068 and the dark hero 28:48074.
     */
    noAdsPanel: { file: 'offer/promo_panel.webp', nineSlice: { left: 52, top: 52, right: 52, bottom: 58, pad: { left: 6, top: 6, right: 6, bottom: 6 } } },
    noAdsDecor: { file: 'offer/noads_rays@0.5x.webp' },
    noAdsClose: { file: 'offer/style1_noads_close.webp' },
    noAdsArt: { file: 'offer/style1_noads_hero.webp' },
    /**
     * theme_light_6 Shop tab `market_screen_dark` 28:46015 (docs/figma/theme-light-6-shop): the purple gradient + bear
     * pattern background, the awning tile (shadow_up + the #0a2259 fade + `pattern_markiza_dark` × 2), the
     * `title_tape_blue_dark` tape without its text (a horizontal 9-slice: the screen stretches it to 978), the
     * `market_card_blue_1_dark` base, the six `icon_coin_dark_2..7` pack renders, and the round × `icon_close_dark`
     * 28:48843 (the No Ads × file).
     */
    shopBackground: { file: 'shop/style1_background@0.5x.webp' },
    shopAwning: { file: 'shop/style1_awning.webp' },
    shopTitle: { file: 'shop/style1_title.webp', nineSlice: { left: 25, top: 58, right: 24, bottom: 58 } },
    shopCard: { file: 'shop/style1_card.webp' },
    shopPack1: { file: 'shop/style1_pack_1.webp' },
    shopPack2: { file: 'shop/style1_pack_2.webp' },
    shopPack3: { file: 'shop/style1_pack_3.webp' },
    shopPack4: { file: 'shop/style1_pack_4.webp' },
    shopPack5: { file: 'shop/style1_pack_5.webp' },
    shopPack6: { file: 'shop/style1_pack_6.webp' },
    shopClose: { file: 'offer/style1_noads_close.webp' }
  },
  /** Figma's kit text: 4 units of OUTSIDE round stroke and a hard drop shadow 4 units down, both in the stroke colour. */
  text: { strokeOutside: 4, shadowY: 4 },
  /** overlay/dim 820:77657 / 85:9387 */
  backdrop: { color: 0x080b0d, alpha: 0.8 },
  hud: {
    capsule: { x: 109, y: 0, width: 218, height: 72 },
    iconSize: 128,
    starIconSize: 112,
    plus: { x: 36, y: 36, width: 53, height: 57 },
    badgeGap: 290,
    heartCount: { x: 0, y: -2, fontSize: 54, stroke: 5 },
    capsuleText: { x: 131, y: -3, fontSize: 40 },
    resourceCount: { x: 131, y: -3, fontSize: 40 },
    gear: { size: 100, backWidth: 145, backHeight: 126.875, rowWidthFactor: 1.45, minHitSize: 160 },
    margins: { left: 60, right: 48, top: 83, settingsTop: 75, rowGap: 40, bottom: 12 },
    responsive: { portraitAreaRatio: 20, landscapeAreaRatio: 50 },
    shadow: false
  },
  levelMap: {
    normalNode: { width: 260, height: 269 },
    hardNode: { width: 258, height: 266 },
    number: { x: 1, y: -3.5, width: 95, fontSize: 84 },
    /** Exact render box of Group 182: logical 92 × 104 plus stroke/shadow bleed. */
    lock: { x: 0, y: 106, width: 100, height: 116 },
    /** Exact render box of the violet HARD component, centred at (5, -102) over the node. */
    hardBadge: { x: 5, y: -102, width: 236, height: 82, textY: -3, fontSize: 40 },
    /** Rectangle 28 is 30 wide; its exact export is 64 wide including the two side shadows. */
    rail: { width: 64 },
    /** Group 268 render bounds: 720 × 376 logical content plus blur bleed. */
    currentGlow: { width: 819, height: 522 },
    showHardWhenLocked: true,
    /**
     * No completed-node art in Figma: Core's rating crown, with the donor star slots' position and size relative to the
     * donor badge circle (centre 0, 44.3; outer radius 108.2 units) re-fitted to Ellipse 4 (centre 0, -4.5; outer
     * radius 128.6). Side stars sit centred on the top rim, the centre star above it, all clear of the number.
     */
    stars: [
      { x: -104.5, y: -84.8, size: 129.1 },
      { x: 0, y: -152.4, size: 150.6 },
      { x: 104.5, y: -84.8, size: 129.1 }
    ],
    /** The violet HARD surface sits across the top rim (Figma), so a HARD node's crown rests on it. */
    starsOnHardBadge: true
  },
  /**
   * theme_light_5: the dark nav components (352 × 396, their top 110 units above the panel rect) on the 24:37551 panel.
   * Slot centres 364 apart (the theme_light_5 bottom strip 24:36128: three 352 slots, 12 apart); a slot centre is 176
   * into its component.
   */
  bottomNav: {
    panelHeight: 286,
    /** The panel's 6-unit #261a30 stroke above its rect. */
    panelBleedTop: 6,
    pitch: 364,
    /** `blue_active_dark` render −6, 82 of the component, 364 × 314 (cut at the screen bottom). */
    selectedBackground: { x: -182, y: -28, width: 364, height: 314 },
    /** state=active: the icon 288 at 32, 17; "SHOP" / "HOME" 34, 305, 284 × 70, Fira Sans Black 54. */
    selected: { icon: { x: 0, y: 51, size: 288 }, label: { x: -142, y: 195, width: 284, height: 70, fontSize: 54 } },
    /** state=inactive: the icon 220 at 66, 98; the label 0, 299, 352 × 74 at 40. */
    normal: { icon: { x: 0, y: 98, size: 220 }, label: { x: -176, y: 189, width: 352, height: 74, fontSize: 40 } },
    /** `navigation_lock_dark` state=inactive: `icon_lock_dark` 220 at 66, 98 with its "LOCK" caption. */
    locked: { icon: { x: 0, y: 98, size: 220 }, label: { x: -176, y: 189, width: 352, height: 74, fontSize: 40 } },
    textFill: 0xffffff,
    /** White Fira Sans Black with a 3-unit OUTSIDE #261a30 stroke and its 4-unit hard shadow. */
    text: { strokeOutside: 3, shadowY: 4, strokeColor: 0x261a30 }
  },
  levelMapScreen: {
    play: {
      /** PLAY 24:37523: box 284, 1663, 512 × 210; render 279, 1658, 522 × 228 (centre 540, 1772). */
      width: 522,
      height: 228,
      /** The render centre 1772, the panel rect top 2058. */
      aboveNav: 286,
      /** "PLAY" 24:37525: 334, 1704, 412 × 104, Fira Sans Black 110, the kit's 4 / 4 outline. */
      label: { x: -206, y: -68, width: 412, height: 104, fontSize: 110 },
      /** Style 1's PLAY shows no level line. */
      level: null,
      textFill: 0xffffff
    }
  },
  /**
   * theme_light_6 dark gameplay 28:48205, MOVES `Group 1356` 28:48247: the white box, "MOVES" Fira Sans Black 60 white and
   * the count 120 #ffc300, both with the kit's 4 / 4 black outline. Where the box goes is the host's composition.
   */
  moves: {
    box: { width: 280, height: 280 },
    panel: { x: 0, y: 0, width: 280, height: 280 },
    label: { x: 40, y: 47, width: 200, height: 60, fontSize: 60, fill: 0xffffff, stroke: { width: 4, color: 0x000000 } },
    count: { x: 40, y: 108, width: 200, height: 140, fontSize: 120, fill: 0xffc300, stroke: { width: 4, color: 0x000000 } }
  },
  /** theme_light_6 `btn_settings` 28:48211 (gameplay and victory): 214 at top 90 / right 90, the gear 10 above the centre. */
  settingsButton: {
    back: { width: 214, height: 214 },
    icon: { x: 28, y: 18, width: 158, height: 158 },
    margins: { top: 90, right: 90 },
    minHitSize: 214
  },
  /**
   * theme_light_6 `market_screen_dark` 28:46015: the SHOP tab of the main-screen navigation (frame units from its top).
   * The #5e2bd4 → #451262 gradient with the bears (the picture; #451262 under it); the × `icon_close_dark` 120 at 921, 301
   * (39 from the right edge); the tape 978 × 116 at 51, 493 with "SPECIAL OFFER" — runtime copy — Fira Sans Black 60 and
   * the kit's 4 / 4 outline at 111, 503, 858 × 78; the cards 310 × 406 at 51 / 385 / 719 × 633 / 1063 (render −4, −4,
   * 318 × 418); the amount 60 at 9.76, 31, 290 × 72, the pack box 25, 86, 260 × 220, the price 56 centred on the card's
   * inner face; the scroll frame ends 64 above the navigation panel (the light screen's `Frame 615`). Desktop: the light
   * PC tab's rule (theme_light_7 43:25602; the dark PC 43:23091 is the legacy modal over gameplay, not the tab): the
   * awning at y −110, the × 21 right of this tape (51 + 978) on its centre line: centre 1110, 551.
   */
  shopScreen: {
    background: { color: 0x451262, art: true },
    awning: { width: 1080, height: 539 },
    close: { y: 301, right: 39, width: 120, height: 120, minHitSize: 160 },
    title: {
      ribbon: { x: 51, y: 493, width: 978, height: 116 },
      label: { x: 111, y: 503, width: 858, height: 78, fontSize: 60 }
    },
    grid: { top: 633, columns: 3, pitchX: 334, pitchY: 430, rows: 2 },
    card: {
      box: { width: 310, height: 406 },
      art: { x: -4, y: -4, width: 318, height: 418 },
      pack: { x: 25, y: 86, width: 260, height: 220 },
      amount: { x: 9.76, y: 31, width: 290, height: 72, fontSize: 60 },
      price: { x: 20.76, y: 313.5, width: 268, height: 67, fontSize: 56 }
    },
    scroll: { top: 485, bottomGap: 64 },
    desktop: { awningY: -110, close: { x: 1110, y: 551 } }
  },
  windows: {
    /** Figma `screen/confirm-exit`: window-local boxes (the `ui/window/base` box sits at 60, 675 of the frame). */
    confirm: {
      /** ui/window/base 820:77659: the 960 × 1198 master (@stretch 80 / 175 / 80 / 80) at 960 × 994. */
      window: { width: 960, height: 994 },
      /** slot/title 73:5211: 690 × 104 box, CENTER / CENTER, Fira Sans Black 80 */
      title: { x: 135, y: 34, width: 690, height: 104, fontSize: 80 },
      /** action/close 73:5212 (50.52 glyph in its 51 × 51 SVG box) */
      close: { x: 863, y: 61, width: 51, height: 51 },
      /** surface/message-card 820:77660: 450 × 354 rounded rect under a 225.7 layer blur */
      glow: { x: 29.3, y: 5.3, width: 902, height: 806 },
      /** art/broken-heart 820:77663 (box 327, 274, 305.4 × 268 + 10 stroke / shadow bleed) */
      heart: { x: 317.001, y: 264, width: 326, height: 298 },
      /** slot/life-delta 820:77672: LEFT / CENTER, hugging, Fira Sans Black 150 */
      lifeDelta: { x: 543, y: 345, width: 146, height: 180, fontSize: 150 },
      /** slot/body 820:77662: 834 × 113 box, CENTER / CENTER, Fira Sans Black 50 */
      body: { x: 63, y: 586, width: 834, height: 113, fontSize: 50 },
      /** ui/button/base 820:77661 */
      button: { x: 180, y: 725, width: 600, height: 206 },
      /** the button's @content / slot/label, button-local; Fira Sans Black 80 */
      buttonLabel: { x: 25, y: 27, width: 550, height: 128, fontSize: 80 }
    },
    /**
     * theme_light_4 `попап восполнить жизни` 22:27562 (`refill_hearts` 22:27999: Component 9 at 960 × 990): frame boxes
     * with the window alone centred (y 677; Figma draws it at 332 above the OFFER panel — the composition is centred).
     * The pre-theme_light_4 window was 1059 high with the buttons 71 lower; the art and the other boxes are unchanged.
     */
    lives: {
      /** Component 9 22:28000: the confirm-exit shell at 960 × 990 */
      window: { x: 60, y: 677, width: 960, height: 990 },
      /** slot/title: CENTER / CENTER, Fira Sans Black 80 */
      title: { x: 195, y: 711, width: 690, height: 104, fontSize: 80 },
      /** action/close (its 51 × 51 SVG box) */
      close: { x: 923, y: 738, width: 51, height: 51 },
      /** Rectangle 65858 22:28002: flat #a2a0f4, radius 50 */
      inset: { x: 90, y: 969, width: 900, height: 382 },
      /** Group 412: the heart */
      heart: { x: 152, y: 1016, width: 326, height: 298 },
      /** "1": 150; the box is the hug box of "1", the count is centred on it */
      count: { x: 272, y: 1071, width: 84, height: 180, fontSize: 150 },
      /** NEXT HEART IN: 50, centre */
      nextLabel: { x: 531, y: 1087, width: 442, height: 60, fontSize: 50 },
      /** 24:15: 70, centre */
      timer: { x: 531, y: 1150, width: 442, height: 84, fontSize: 70 },
      /** Group 381 22:28017: ui/button/surface green */
      refill: { x: 90, y: 1396, width: 371, height: 207 },
      refillLabel: { x: 112, y: 1402, width: 331, height: 84, fontSize: 50 },
      /** Frame 381: price text + 1 + coin, hugging, centred on the button, rows centred in 100 */
      priceRow: { y: 1472, height: 100, gap: 1, fontSize: 64 },
      coin: { width: 100, height: 100 },
      /** Group 396 22:28037: ui/button/surface orange + the gold highlight */
      ad: { x: 483, y: 1396, width: 507, height: 207 },
      adHighlight: { x: 491, y: 1401, width: 307, height: 172 },
      adLabel: { x: 620, y: 1409, width: 233.199, height: 159, fontSize: 60 },
      /** Group 385: the rewarded-ad clapper (render box) */
      adIcon: { x: 511, y: 1412, width: 128, height: 134 },
      rewardIcon: { x: 819, y: 1412, width: 154, height: 154 },
      /** +1: LEFT, hugging */
      rewardLabel: { x: 859, y: 1447, width: 68, height: 72, fontSize: 60 }
    },
    /**
     * theme_light_4 OFFER (22:28069 under Lives, 22:28122 under Restart): a 960 × 640 Component 9, 50 under the window.
     * Panel-local boxes. Its × is the shell's own (it closes the window). The bubble under it ("Продолжить с +3★",
     * bubble_2) is game copy about the game's stars — not part of the Core panel.
     */
    offer: {
      panel: { width: 960, height: 640, gap: 50 },
      title: { x: 135, y: 34, width: 690, height: 104, fontSize: 80 },
      close: { x: 863, y: 61, width: 51, height: 51 },
      /** icon_sale render (300 × 300 canvas around the turned burst) */
      badge: { x: -80, y: -45, width: 300, height: 300 },
      /** "х3": Fira Sans Black 90, its 107.5 × 117.27 box centred at 64.79, 92.58, turned −30° */
      badgeLabel: { x: 11.04, y: 33.95, width: 107.5, height: 117.27, fontSize: 90, rotation: -30 },
      /** a host hero: the coin's logical box (260 × 268.67 centred at 229, 370.33) */
      icon: { x: 99, y: 236, width: 260, height: 268.67 },
      /** the style's heroes at their render boxes: the heart (Group 170 render at 65.98, 230.9), the coin (22:28125 render) */
      iconArt: {
        offerLivesArt: { x: 65.98, y: 230.9, width: 326, height: 298 },
        offerCoinArt: { x: 95.9, y: 232.9, width: 267, height: 278 }
      },
      /** "35d" / "2000": Fira Sans Black 100, centred at 235, 519.41 */
      iconLabel: { x: 70, y: 459.41, width: 330, height: 120, fontSize: 100 },
      /** tips 22:28084: the two 162 boosters and their counts (Fira Sans Black 80) */
      items: [
        { icon: { x: 503, y: 192, width: 162, height: 162 }, label: { x: 487, y: 296, width: 106, height: 96, fontSize: 80 } },
        { icon: { x: 695, y: 192, width: 162, height: 162 }, label: { x: 679, y: 296, width: 106, height: 96, fontSize: 80 } }
      ],
      /** Btn_base 22:28089 (green, 428 × 180) */
      button: { x: 458, y: 408, width: 428, height: 180 },
      /** "900" (80) + the 100 coin, no gap, one row centred at 78 from the button top */
      price: { y: 23, height: 110, gap: 0, fontSize: 80 },
      coin: { width: 100, height: 100, y: 28 }
    },
    /**
     * Current SettingsWindowView only. All boxes are local to the window's top-left. The legacy notification,
     * privacy and restore controls are intentionally absent: the current runtime has no state or callbacks for them.
     *
     * One dense column for the map and in-level windows (the manual test of the theme_light_4 pass found the centred
     * toggle row of 22:28430 / the inserted action rows leaving a large empty band): the Component 9 shell (header 175),
     * the toggles right under it (labels 204, buttons 291 — Style 1's toggle row), then the rows 40 below the toggles and
     * 25 apart (599 × 207, the RETURN HOME / RESTART art), the version 49 under the last row, 52 to the bottom. The
     * language row (no Style 1 Figma node; theme_light_4 has one only in Style 2) is the same row on Style 1's own blue
     * `Btn` surface (`settingsBtnLanguage`, the toggles' blue variant as a 9-slice), its name runtime text, no icon. Rows
     * a show does not draw close up (SettingsWindowView). SETTINGS is 100 (the other windows' titles 80); the version
     * #716dd0 40 is plain (no stroke / shadow); the × is the shell's violet one.
     */
    settings: {
      map: {
        window: { width: 960, height: 907 },
        title: { x: 135, y: 34, width: 690, height: 104, fontSize: 100 },
        close: { x: 863, y: 61, width: 51, height: 51 },
        sound: {
          button: { x: 62, y: 291, width: 224, height: 220 },
          label: { x: 77, y: 204, width: 194, height: 72, fontSize: 60 },
          off: { x: 32.5, y: 29, width: 159, height: 162 }
        },
        music: {
          button: { x: 368, y: 291, width: 224, height: 220 },
          label: { x: 393, y: 204, width: 174, height: 72, fontSize: 60 },
          off: { x: 32.5, y: 29, width: 159, height: 162 }
        },
        haptic: {
          button: { x: 674, y: 291, width: 224, height: 220 },
          label: { x: 688, y: 204, width: 197, height: 72, fontSize: 60 },
          off: { x: 32.5, y: 29, width: 159, height: 162 }
        },
        language: {
          button: { x: 181, y: 551, width: 599, height: 207 },
          label: { x: 25, y: 27, width: 549, height: 128, fontSize: 70 }
        },
        version: { x: 267, y: 807, width: 439, height: 48, fontSize: 40, outline: false }
      },
      gameplay: {
        window: { width: 960, height: 1371 },
        title: { x: 135, y: 34, width: 690, height: 104, fontSize: 100 },
        close: { x: 863, y: 61, width: 51, height: 51 },
        sound: {
          button: { x: 62, y: 291, width: 224, height: 220 },
          label: { x: 77, y: 204, width: 194, height: 72, fontSize: 60 },
          off: { x: 32.5, y: 29, width: 159, height: 162 }
        },
        music: {
          button: { x: 368, y: 291, width: 224, height: 220 },
          label: { x: 393, y: 204, width: 174, height: 72, fontSize: 60 },
          off: { x: 32.5, y: 29, width: 159, height: 162 }
        },
        haptic: {
          button: { x: 674, y: 291, width: 224, height: 220 },
          label: { x: 688, y: 204, width: 197, height: 72, fontSize: 60 },
          off: { x: 32.5, y: 29, width: 159, height: 162 }
        },
        restart: {
          button: { x: 181, y: 551, width: 599, height: 207 },
          label: { x: 190, y: 27, width: 360, height: 128, fontSize: 70 },
          icon: { x: 44.5, y: 16, width: 170, height: 155 }
        },
        home: {
          button: { x: 181, y: 783, width: 599, height: 207 },
          label: { x: 25, y: 27, width: 549, height: 128, fontSize: 70 }
        },
        language: {
          button: { x: 181, y: 1015, width: 599, height: 207 },
          label: { x: 25, y: 27, width: 549, height: 128, fontSize: 70 }
        },
        version: { x: 267, y: 1271, width: 439, height: 48, fontSize: 40, outline: false }
      }
    },
    /**
     * Figma `screen/result-win` 1:3854 / `screen/result-fail` 1:4029 (docs/figma/style1-result): frame boxes. The hero art
     * above the ribbon (art/result-*-hero: a trophy, the game's bear) is game content and not part of the style; the WIN
     * star crown keeps that place.
     */
    result: {
      /**
       * theme_light_6 `screen_victory_pc_dark` 28:48286 (docs/figma/theme-light-6): the same ribbon, coin, button
       * surfaces and highlight as 1:3854, re-laid. Figma's PC composition is off-centre (the ribbon on x 612.5, the reward
       * column on 508 — the new 1022-wide ribbon instance dropped at the old band x); Core centres every part on 540, at
       * theme_light_6's y. No glow and no star in theme_light_6: the crown keeps its offsets from the ribbon top.
       */
      win: {
        /** pic_tape_red_dark 28:49231 = the 1:4024 art (mean 0.68 / 255 one unit lower): its render box */
        ribbon: { x: 31, y: 652, width: 1019, height: 239 },
        /** the ribbon's text, band +8.04 / +112.55: Fira Sans Black 90 / 70, CENTER / CENTER */
        title: { x: 133, y: 663.04, width: 816, height: 104.51, fontSize: 90 },
        subtitle: { x: 133, y: 767.55, width: 816, height: 70.34, fontSize: 70 },
        /** icon_close_dark_2 28:49423: band +824, +40, 50 × 50 */
        close: { x: 957, y: 695, width: 50, height: 50 },
        glow: null,
        /** No Figma node: Core's crown at the donor offsets from the ribbon's top edge (−103.5 / −163.5), centred on it. */
        stars: [
          { x: 268.5, y: 548.5, size: 240 },
          { x: 540.5, y: 488.5, size: 288 },
          { x: 812.5, y: 548.5, size: 240 }
        ],
        /** REWARDS 28:48315: Fira Sans Black 50 */
        rewardsLabel: { x: 319, y: 888, width: 442, height: 60, fontSize: 50 },
        /** icon_coin_128 28:48299 (256 box): the coin's render box */
        coin: { x: 442, y: 966, width: 196, height: 210 },
        /** 28:48314 "500": Fira Sans Black 80, hugging, centred at 540.5, 1186 */
        amount: { x: 340.5, y: 1138, width: 400, height: 96, fontSize: 80 },
        /** Btn_green_dark_2 28:48318 (440 × 200) + CONTINUE (60) centred on the face (5..170) */
        next: { button: { x: 71.5, y: 1292, width: 440, height: 200 }, label: { x: 22, y: 9.5, width: 396, height: 159, fontSize: 60 } },
        /**
         * btn_orange_dark's inner button (460 × 200) and its highlight; the runtime RETRY label on the face (Figma's
         * rewarded x2 offer — tv, x2 ticket, price — is not Core's). Both buttons on one row (Figma: 1293 / 1291).
         */
        retry: {
          button: { x: 548.5, y: 1292, width: 460, height: 200 },
          label: { x: 22, y: 9.5, width: 416, height: 159, fontSize: 60 },
          highlight: { x: 17.2, y: 4.67, width: 322.43, height: 167.29 }
        }
      },
      fail: {
        /** ui/ribbon/title grey 1:4141 */
        ribbon: { x: 31, y: 731, width: 1019, height: 239 },
        /** slot/level 1:4146: Fira Sans Black 90, one line centred on the ribbon */
        title: { x: 133, y: 785, width: 816, height: 104, fontSize: 90 },
        /** action/close 1:4142 */
        close: { x: 957, y: 774, width: 51, height: 51 },
        /** Rectangle 218 1:4130 */
        glow: { x: -163.7, y: 777.3, width: 1408, height: 768 },
        /** Group 170 + Vector 28 (305.4 × 268 at 387, 1027): the broken heart's render box */
        lifeLost: { x: 377, y: 1017, width: 326, height: 298 },
        /** 1:4140 "-1": Fira Sans Black 150, LEFT / CENTER */
        lifeDelta: { x: 578, y: 1134, width: 146, height: 180, fontSize: 150 },
        /** slot/status 1:4148: Fira Sans Black 50 */
        status: { x: 123, y: 1348, width: 834, height: 113, fontSize: 50 },
        /** ui/button/base 1:4147 (the confirm-exit button, slot/label 80) */
        retry: { button: { x: 240, y: 1461, width: 600, height: 206 }, label: { x: 25, y: 27, width: 550, height: 128, fontSize: 80 } },
        /** No Figma node: the kit's fail EXIT rule — 0.85 of the RETURN HOME art (599 × 207), 26 units under RETRY */
        exit: { button: { x: 285.5, y: 1693, width: 509, height: 176 }, label: { x: 21, y: 23, width: 467, height: 109, fontSize: 68 } }
      }
    },
    /**
     * theme_light_6 `screen_ads_off` 28:48065: window-local boxes of the 1000 × 1860 promo window (40, 202 of the frame).
     * The title lines are `wordNo` / `wordAds` (Fira Sans Black 120 / 100, the black 4-unit outline): line 1's vertical
     * pink gradient (#ffaee8 → #ea001f, visible #f97cae → #f1365d) is drawn as its middle #f55985, and the group's soft
     * shadow as the kit's hard one. The description's first line wraps in the 930 box (90), the rest is the note (50);
     * the price row is "900" (80) + the 100 coin, no gap, centred on the button.
     */
    noAds: {
      window: { width: 1000, height: 1860 },
      /** icon_close_dark 28:48068 (120, its render box) */
      close: { x: 838, y: 26, width: 120, height: 120 },
      /** pic_decor_2 28:48073: render box */
      decor: { x: -24.87, y: 289.13, width: 1045.75, height: 1045.75 },
      /** pic_pig_1 28:48074 */
      hero: { x: 150, y: 450, width: 700, height: 700 },
      title: [
        { x: 62, y: 130, width: 876, height: 240, fontSize: 120, fill: 0xf55985, stroke: { width: 4, color: 0x000000 } },
        { x: 100, y: 232, width: 800, height: 240, fontSize: 100, stroke: { width: 4, color: 0x000000 } }
      ],
      description: { x: 35, y: 1164, width: 930, height: 250, fontSize: 90 },
      note: { x: 35, y: 1434, width: 930, height: 90, fontSize: 50 },
      /** Btn_green_dark_2 28:48077 (530 × 200) */
      button: { x: 235, y: 1590, width: 530, height: 200 },
      price: { y: 36, height: 128, gap: 0, fontSize: 80 },
      coin: { width: 100, height: 100, y: 50 }
    }
  }
} as const satisfies ReadyUiSkin;

/**
 * Style 1's legacy Confirm/Lives roles → the kit names the same files had before styles
 * (`READY_UI_OPTIONAL_ASSET_FILES`, loaded by `include: CONFIRM_EXIT_FIGMA_TEXTURES / LIVES_FIGMA_TEXTURES`). Only
 * the pre-style `variant: 'figma'` path reads it; Settings has no legacy include path.
 */
export const STYLE_1_INCLUDE_NAMES = {
  windowSurface: 'windowBase',
  windowClose: 'windowClose',
  heroGlow: 'messageGlow',
  lifeLostArt: 'brokenHeart',
  buttonPrimary: 'buttonGreen',
  buttonRewarded: 'buttonOrange',
  buttonHighlight: 'buttonHighlight',
  panelInset: 'panelInset',
  lifeArt: 'livesHeart',
  priceIcon: 'iconCoin',
  rewardIcon: 'iconHeart',
  adIcon: 'iconAd'
} as const satisfies Partial<Record<ReadyUiSkinRole, ReadyUiOptionalTextureName>>;
