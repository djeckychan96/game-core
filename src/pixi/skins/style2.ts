import type { ReadyUiSkin } from '../skin';

/**
 * Style 2 — the artist's light-blue `theme_light_3` (file 5FWFwdO4QGeDfeQtloLNOS), LevelMap screen V1.
 *
 * COVERS: `hud`, `levelMap`, `bottomNav` and `levelMapScreen`, from ONE approved screen: `screen_gameplay_pc` 8:23174
 * (docs/figma/style2-level-map-screen). NOT COVERED — donor look: every window (Confirm, Lives, Settings, Result,
 * Shop, NoAds, StarterPack). The other screens and the older variants that still lie in `theme_light_3` are not a
 * source for this package.
 *
 * Units are the 4168 × 2344 screen frame's — the frame is 2344 high, like the kit's portrait design box, so the
 * views' contain fit keeps Figma's sizes. Node art is in node units: the blue locked node is 288 (its component), the
 * orange node is the same art × 4/3 in Figma, drawn here at the same 288 base (its texture keeps the 384 px render).
 * Every texture is Figma's own transparent render of a leaf / static visual (no text, no sample values inside);
 * numbers, labels, counters, stars and states stay runtime. Text: Calibri Bold in Figma → Carlito Bold (OFL,
 * metric-compatible), white, no stroke, no shadow; the HUD counters are #3f598c.
 */
export const READY_UI_STYLE_2 = {
  id: 'style-2',
  covers: ['hud', 'levelMap', 'bottomNav', 'levelMapScreen'],
  frame: { width: 4168, height: 2344 },
  assets: {
    /** `header_back` 8:17609: render 515 × 182 at 67, 27 of the 582 × 236 bar (the bar clips its right shadow, as in Figma). */
    hudCapsule: { file: 'style2/hud_capsule.webp' },
    /** The 288 icon components (their own PNG@1x exports), drawn at 236. */
    hudHeart: { file: 'style2/icon_heart.webp' },
    hudCoin: { file: 'style2/icon_coin.webp' },
    hudStar: { file: 'style2/icon_star.webp' },
    /** `icon_plus_1` 8:17683, 114 × 114. */
    hudPlus: { file: 'style2/hud_plus.webp' },
    /** `reward_stars_1` 8:17657 without its sample layers (earned stars, the "3"): the orange base + three empty slots, 384 px. */
    levelNodeNormal: { file: 'style2/level_node_open.webp' },
    /** `reward_stars_2` 8:17670 without its sample layers (the gold star, the lock, the "25"): the blue base + three empty slots. */
    levelNodeLocked: { file: 'style2/level_node_locked.webp' },
    levelLock: { file: 'style2/icon_lock.webp' },
    /** `pic_light_ray` 8:23222: 32 rows from the middle of its render (vertically uniform), stretched per segment. */
    levelRail: { file: 'style2/level_rail.webp' },
    /** The centre earned star is the star icon itself; the side ones are Figma's render of 8:17667 and its mirror. */
    levelStarGold: { file: 'style2/icon_star.webp' },
    levelStarGoldL: { file: 'style2/level_star_l.webp' },
    levelStarGoldR: { file: 'style2/level_star_r.webp' },
    /** `bg_2` 8:23221: the raw 1672 × 941 sky (clouds and translucent stars inside), lossy WebP q90, cover-fit. */
    levelMapBackground: { file: 'style2/bg_sky.webp' },
    /** `bottom_panel` 8:17713: its centre 8 columns, rows 0..295; top cap = shadow + highlight, bottom cap = the inner shadow. */
    navPanel: { file: 'style2/nav_panel.webp', nineSlice: { left: 0, top: 20, right: 0, bottom: 14 } },
    /** `blue_active` 8:23254: the measured caps (the 50 corners + 6 shadow, a 2-unit gutter) around an 8-unit centre. */
    navSelected: { file: 'style2/nav_selected.webp', nineSlice: { left: 56, top: 58, right: 57, bottom: 2 } },
    navLock: { file: 'style2/icon_lock.webp' },
    /** Item icons a host may name in a BottomNavView item (`icon: 'iconShop'`). */
    iconShop: { file: 'style2/icon_shop.webp' },
    iconHome: { file: 'style2/icon_home.webp' },
    /** `btn_green` 8:23224 (no wings): 550 × 280, its labels runtime. */
    playButton: { file: 'style2/play.webp' }
  },
  font: { family: 'Carlito', file: 'fonts/Carlito-Bold.woff' },
  text: { strokeOutside: 0, shadowY: 0, fill: 0xffffff },
  /** No Style 2 window yet: the donor dim (unused). */
  backdrop: { color: 0x000000, alpha: 0.55 },
  windows: {},
  hud: {
    /** One `icon_bar` (582 × 236): the icon box 0..236 (its centre is the badge origin), the capsule's render centre at 324.5, 118. */
    capsule: { x: 206.5, y: 0, width: 515, height: 182 },
    iconSize: 236,
    starIconSize: 236,
    /** `icon_plus_1` at 146, 109 of the bar. */
    plus: { x: 85, y: 48, width: 114, height: 114 },
    /** Bars at 60 / 670 / 1280. */
    badgeGap: 610,
    /** Figma's heart carries no count: the lives value drives the capsule text (MAX / timer) and the "+". */
    heartCount: null,
    /** The text box 233, 69, 300 × 98: Calibri Bold 80, centre. */
    capsuleText: { x: 265, y: 0, fontSize: 80 },
    resourceCount: { x: 265, y: 0, fontSize: 80 },
    textFill: 0x3f598c,
    /** No settings gear in 8:23174. */
    gear: null,
    /** `icons_top` at 60, 60 inside the 300-high `top_bar_frame`. */
    margins: { left: 60, right: 60, top: 60, settingsTop: 60, rowGap: 0, bottom: 4 },
    /** Figma's size, shrunk only to fit the width. */
    responsive: null,
    shadow: false
  },
  levelMap: {
    normalNode: { width: 288, height: 288 },
    lockedNode: { width: 288, height: 288 },
    hardNode: null,
    /** "3" of 8:17657: box 116, 187, 152 × 171 at 140 in the 384 component → × 0.75. */
    number: { x: 0, y: 60.375, width: 114, fontSize: 105 },
    /** "25" of 8:17670: box 87, 129, 114 × 92 at 75. */
    lockedNumber: { x: 0, y: 31, width: 114, fontSize: 75 },
    digitScale: [1, 1, 1],
    /** `icon_lock` of 8:17670: the 86.4 image centred at 144, 244. */
    lock: { x: 0, y: 100, width: 86.4, height: 86.4 },
    /** No HARD art in 8:23174: a hard level draws like a normal one. */
    hardBadge: null,
    rail: { width: 80 },
    currentGlow: null,
    background: true,
    showHardWhenLocked: false,
    /**
     * The earned stars of 8:17657 (× 0.75): centre 8:17665 (170.488 at 105.726, 7.352); left 8:17667 (its render box
     * 0..174 × 60.27..258.27, star centre 74.27, 159.24); right = the mirror, centred where the hidden 8:17666 is
     * (306.02, 159.24). Sizes are the textures' widths in node units.
     */
    stars: [
      { x: -78.75, y: -24.55, size: 130.5 },
      { x: -0.773, y: -74.55, size: 127.866 },
      { x: 75.97, y: -24.55, size: 130.5 }
    ],
    starsOnHardBadge: false
  },
  bottomNav: {
    /** `bottom_panel` rect: 286 high at 2058 (to the frame bottom). */
    panelHeight: 286,
    panelBleedTop: 10,
    /** Slot centres 1457.4 / 2122 / 2785. */
    pitch: 664,
    /** `blue_active` render 1275.2, 2030, 364.3 × 314 around the slot centre 1457.4. */
    selectedBackground: { x: -182.169, y: -28, width: 365, height: 314 },
    selected: {
      /** `icon_market` 288 at 1313, 1948. */
      icon: { x: 0, y: 34, size: 288 },
      /** "SHOP" 1315, 2230, 284 × 71, Calibri Bold 60. */
      label: { x: -142.398, y: 172, width: 284, height: 71, fontSize: 60 }
    },
    normal: {
      /** `icon_home` 220 at 2012, 2034. */
      icon: { x: 0, y: 86, size: 220 },
      /** "HOME" 1977, 2246, 290 × 49, Calibri Bold 40. */
      label: { x: -145, y: 188, width: 290, height: 49, fontSize: 40 }
    },
    locked: {
      /** `icon_lock` 8:23251: the 220.3 image centred at 2784.95, 2151.95, no label. */
      icon: { x: 0, y: 93.95, size: 220.3 },
      label: null
    },
    textFill: 0xffffff
  },
  levelMapScreen: {
    play: {
      width: 550,
      height: 280,
      /** PLAY centre 1762, the panel top 2058. */
      aboveNav: 296,
      /** "PLAY" 1863, 1657, 446 × 146, Calibri Bold 120 (button centre 2084, 1762). */
      label: { x: -221, y: -105, width: 446, height: 146, fontSize: 120 },
      /** "Level N" 1859, 1782, 450 × 85, Calibri Bold 70. */
      level: { x: -225, y: 20, width: 450, height: 85, fontSize: 70 },
      textFill: 0xffffff
    }
  }
} as const satisfies ReadyUiSkin;
