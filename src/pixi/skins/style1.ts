import type { ReadyUiOptionalTextureName } from '../assets';
import type { ReadyUiSkin, ReadyUiSkinRole } from '../skin';

/**
 * Style 1 — the Figma "HAMSTER PIXEL FLOW" Ready UI.
 *
 * COVERS: `confirm` (screen/confirm-exit 820:77655, docs/figma/confirm-exit) and `lives` (screen/lives 85:8944,
 * docs/figma/lives), the current runtime surface of `settings`, plus HUD and LevelMap from the canonical level-select
 * screens (file sJ0BV1ARqMpcj5dZbjFppz, desktop 1:911 / mobile 1:1301). NOT COVERED — donor look: Result, Shop,
 * NoAds, StarterPack.
 *
 * Every number is the Figma read (unchanged from the `variant: 'figma'` windows): boxes in design units of the
 * 1080 × 2344 frame, art boxes = the SVG export (render) boxes. The files are the ones Core already ships under
 * `assets/pixi-ui/` (rendered by `node scripts/figma-assets.mjs`, no text inside any of them); the 9-slice caps are
 * measured on those rasters: the Figma @stretch insets plus the art's bleed, grown where an effect or a corner reaches
 * into the stretch area, plus an 8-unit gutter at every seam (docs/figma/confirm-exit/README.md lists the numbers).
 */
export const READY_UI_STYLE_1 = {
  id: 'style-1',
  covers: ['confirm', 'lives', 'settings', 'hud', 'levelMap'],
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
    /** Settings close glyph (51 × 51). */
    settingsClose: { file: 'button/btn_close.webp' },
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
    levelStarGoldR: { file: 'level/star_gold_r.webp' }
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
    /** Figma `screen/lives`: frame boxes (modal/lives 95:22202 is 960 × 1059 at 60, 642). */
    lives: {
      /** ui/window/base 85:9689: the confirm-exit shell at 960 × 1059 */
      window: { x: 60, y: 642, width: 960, height: 1059 },
      /** slot/title: CENTER / CENTER, Fira Sans Black 80 */
      title: { x: 195, y: 676, width: 690, height: 104, fontSize: 80 },
      /** action/close (its 51 × 51 SVG box) */
      close: { x: 923, y: 703, width: 51, height: 51 },
      /** section/next-life Rectangle 65858: flat #a2a0f4, radius 50 */
      inset: { x: 90, y: 934, width: 900, height: 382 },
      /** Group 377: the heart */
      heart: { x: 152, y: 981, width: 326, height: 298 },
      /** Group 378 "1": 150; the box is the hug box of "1", the count is centred on it */
      count: { x: 272, y: 1036, width: 84, height: 180, fontSize: 150 },
      /** NEXT HEART IN: 50, centre */
      nextLabel: { x: 531, y: 1052, width: 442, height: 60, fontSize: 50 },
      /** 24:15: 70, centre */
      timer: { x: 531, y: 1115, width: 442, height: 84, fontSize: 70 },
      /** action/refill-coins: ui/button/surface green */
      refill: { x: 90, y: 1432, width: 371, height: 207 },
      refillLabel: { x: 112, y: 1438, width: 331, height: 84, fontSize: 50 },
      /** Frame 381: price text + 1 + coin, hugging, centred on the button, rows centred in 100 */
      priceRow: { y: 1508, height: 100, gap: 1, fontSize: 64 },
      coin: { width: 100, height: 100 },
      /** action/rewarded-life: ui/button/surface orange + the gold highlight */
      ad: { x: 483, y: 1432, width: 507, height: 207 },
      adHighlight: { x: 491, y: 1437, width: 307, height: 172 },
      adLabel: { x: 620, y: 1445, width: 233.199, height: 159, fontSize: 60 },
      /** Group 385: the rewarded-ad clapper (render box) */
      adIcon: { x: 511, y: 1448, width: 128, height: 134 },
      rewardIcon: { x: 819, y: 1448, width: 154, height: 154 },
      /** +1: LEFT, hugging */
      rewardLabel: { x: 859, y: 1483, width: 68, height: 72, fontSize: 60 }
    },
    /**
     * Current SettingsWindowView only. All boxes are local to the window's top-left. The legacy notification,
     * privacy and restore controls are intentionally absent: the current runtime has no state or callbacks for them.
     */
    settings: {
      /** map-a / map-b collapse to the one current map layout; their unsupported legacy controls are not represented. */
      map: {
        window: { width: 960, height: 1090 },
        title: { x: 135, y: 34, width: 690, height: 104, fontSize: 80 },
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
        version: { x: 267, y: 994, width: 439, height: 48, fontSize: 40 }
      },
      gameplay: {
        window: { width: 960, height: 1576 },
        title: { x: 135, y: 34, width: 690, height: 104, fontSize: 80 },
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
          button: { x: 181, y: 988, width: 599, height: 207 },
          label: { x: 190, y: 27, width: 360, height: 128, fontSize: 70 },
          icon: { x: 44.5, y: 16, width: 170, height: 155 }
        },
        home: {
          button: { x: 181, y: 1220, width: 599, height: 207 },
          label: { x: 25, y: 27, width: 549, height: 128, fontSize: 70 }
        },
        version: { x: 267, y: 1476, width: 439, height: 48, fontSize: 40 }
      }
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
