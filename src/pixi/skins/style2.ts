import type { ReadyUiSkin } from '../skin';
import { READY_UI_STYLE_1 } from './style1';

/** The popup of 8:17493 / 8:22838 (`popup_back` + `header_back`, no title, no close): Settings and Lives draw the same file. */
const POPUP = {
  file: 'style2/settings_panel.webp',
  nineSlice: { left: 191, top: 167, right: 191, bottom: 88, pad: { left: 0, top: 49, right: 0, bottom: 0 } }
} as const;

/**
 * Style 2 — the artist's light-blue `theme_light_3` (file 5FWFwdO4QGeDfeQtloLNOS): LevelMap screen V1, Settings,
 * Confirm and Refill Hearts.
 *
 * COVERS: `hud`, `levelMap`, `bottomNav` and `levelMapScreen`, from the approved `screen_gameplay_pc` 8:23174
 * (docs/figma/style2-level-map-screen); `settings`, from the approved `настройки` 8:17493 (docs/figma/style2-settings);
 * `confirm`, from the approved `попап рестарт` 8:22049 / `попап выйти` 8:22069 (docs/figma/style2-confirm); `lives`,
 * from the approved `screen_refill_hearts` 8:22838 (docs/figma/style2-refill-hearts). NOT COVERED — donor look:
 * Result, Shop, NoAds, StarterPack. The other screens and the older variants that still lie in `theme_light_3` are
 * not a source for this package; every covered screen is a provisional approved snapshot (the artist may still
 * change Style 2 — see each docs/figma folder).
 *
 * Units: every screen is 2344 high, like the kit's portrait design box, so the views' contain fit keeps Figma's sizes.
 * `frame` is the 1080 × 2344 mobile frame of 8:17493 — only the windows fit into it (the HUD, map, nav and PLAY lay
 * out against the theme's design box and never read it); the LevelMap numbers are 4168 × 2344 frame units. Node art is in node units: the blue locked node is 288 (its component), the
 * orange node is the same art × 4/3 in Figma, drawn here at the same 288 base (its texture keeps the 384 px render).
 * Every texture is Figma's own transparent render of a leaf / static visual (no text, no sample values inside);
 * numbers, labels, counters, stars and states stay runtime. Text: Calibri Bold in Figma → Carlito Bold (OFL,
 * metric-compatible), white, no stroke, no shadow; the HUD counters are #3f598c.
 */
export const READY_UI_STYLE_2 = {
  id: 'style-2',
  covers: ['hud', 'levelMap', 'bottomNav', 'levelMapScreen', 'settings', 'confirm', 'lives'],
  frame: { width: 1080, height: 2344 },
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
    playButton: { file: 'style2/play.webp' },
    /**
     * Settings 8:17493: `popup_back` + `header_back` (no title, no close), the header 49 above the 1000 × 1050 box.
     * Caps measured on Figma's render (± its dither): the header and the corners stay, the white body stretches.
     */
    settingsPanel: POPUP,
    /** `btn_close` (btn_red + icon_close): its 153 × 158 render box. */
    settingsClose: { file: 'style2/settings_close.webp' },
    /** `btn_sound` 228: btn_blue + the icon (ON), btn_grey + the icon (OFF, the slash is `settingsOff`). */
    settingsSound: { file: 'style2/settings_sound.webp' },
    settingsSoundOff: { file: 'style2/settings_sound_off.webp' },
    settingsMusic: { file: 'style2/settings_music.webp' },
    settingsMusicOff: { file: 'style2/settings_music_off.webp' },
    /** `red_line` 8:17554 (190), over the OFF button. */
    settingsOff: { file: 'style2/settings_off.webp' },
    /** `btn_green` / `btn_red` at 822 × 200 (no icon, no text) and their icons `icon_return` 8:17504 / `icon_home` 8:17536. */
    settingsBtnRestart: { file: 'style2/settings_btn_restart.webp' },
    settingsBtnHome: { file: 'style2/settings_btn_home.webp' },
    settingsIconRestart: { file: 'style2/settings_icon_restart.webp' },
    settingsIconHome: { file: 'style2/settings_icon_home.webp' },
    /**
     * Refill Hearts 8:22838: the `popup` instance is the Settings popup at 960 × 1050 (its header stretches with the
     * width) — the same file and caps; its `btn_close` is the Settings close.
     */
    windowSurface: POPUP,
    windowClose: { file: 'style2/settings_close.webp' },
    /** `btn_green` 8:22858 / `btn_yellow` 8:22851 (the 214 components at 354 / 460 × 214): vertical gradients, only the width stretches. */
    buttonPrimary: { file: 'style2/button_primary.webp', nineSlice: { left: 48, top: 103, right: 48, bottom: 103 } },
    buttonRewarded: { file: 'style2/button_rewarded.webp', nineSlice: { left: 48, top: 103, right: 48, bottom: 103 } },
    /** `frame_blur_bg` 8:22841: a soft blue blur, drawn whole at its render box (caps 0: it never stretches there). */
    panelInset: { file: 'style2/lives_glow@0.5x.webp', nineSlice: { left: 0, top: 0, right: 0, bottom: 0 } },
    /** `icon_heart_1` 8:17643: the HUD heart, drawn at 338 (the lives count over it is runtime) and at 128 (the reward). */
    lifeArt: { file: 'style2/icon_heart.webp' },
    rewardIcon: { file: 'style2/icon_heart.webp' },
    /** `icon_coin` 8:22862: the price coin (its own small raster, not the HUD coin). */
    priceIcon: { file: 'style2/price_coin@2x.webp' },
    /** `icon_tv_1` 8:17637: the rewarded-ad icon. */
    adIcon: { file: 'style2/icon_tv.webp' },
    /**
     * Confirm 8:22049 / 8:22069 is the Style 1 window (`Component 8` 1:937, `Btn_base` 1:969, the broken heart): its
     * render matches Style 1's confirm-exit reference (mean |Δ| 0.0), so it draws Style 1's own files — window-scoped
     * where Lives draws the same role with the Style 2 popup art.
     */
    'confirm:windowSurface': READY_UI_STYLE_1.assets.windowSurface,
    'confirm:windowClose': READY_UI_STYLE_1.assets.windowClose,
    'confirm:buttonPrimary': READY_UI_STYLE_1.assets.buttonPrimary,
    heroGlow: READY_UI_STYLE_1.assets.heroGlow,
    lifeLostArt: READY_UI_STYLE_1.assets.lifeLostArt
  },
  font: { family: 'Carlito', file: 'fonts/Carlito-Bold.woff' },
  text: { strokeOutside: 0, shadowY: 0, fill: 0xffffff },
  /** 8:17494: #080b0d at 0.8 over the screen. */
  backdrop: { color: 0x080b0d, alpha: 0.8 },
  windows: {
    /**
     * Confirm 8:22049 (RESTART) / 8:22069 (EXIT): one window, the button's copy is the host's action. The Style 1
     * geometry (window-local, the window box at 60, 675) and the Style 1 type: Fira Sans Black with 4 units of outside
     * stroke and a 4-unit hard shadow — the kit font, not Carlito.
     */
    confirm: {
      window: { width: 960, height: 994 },
      text: { strokeOutside: 4, shadowY: 4 },
      title: { x: 135, y: 34, width: 690, height: 104, fontSize: 80 },
      close: { x: 863, y: 61, width: 51, height: 51 },
      /** Rectangle 218 8:22054: 450 × 354 r138 under a 225.7 layer blur (its render box) */
      glow: { x: 29.3, y: 5.3, width: 902, height: 806 },
      /** Group 377 / 378: the broken heart (render box, 10 units of stroke / shadow bleed) */
      heart: { x: 317.001, y: 264, width: 326, height: 298 },
      /** "-1" 8:22068: Fira Sans Black 150, LEFT / CENTER */
      lifeDelta: { x: 543, y: 345, width: 146, height: 180, fontSize: 150 },
      /** "YOU WILL LOSE 1 HEART" 8:22056: 834 × 113, Fira Sans Black 50 */
      body: { x: 63, y: 586, width: 834, height: 113, fontSize: 50 },
      /** Btn_base 8:22055 */
      button: { x: 180, y: 725, width: 600, height: 206 },
      /** Frame 498 (button-local); "RESTART" / "EXIT" Fira Sans Black 80 */
      buttonLabel: { x: 25, y: 27, width: 550, height: 128, fontSize: 80 }
    },
    /**
     * Refill Hearts 8:22838: frame boxes (the popup box at 60, 647). Calibri Bold → Carlito: title / buttons white,
     * "Next heart in" and the timer #3f598c, the lives count and the reward "+1" white with a #9b170b outside stroke.
     * No highlight on the rewarded button. The top HUD of the sample screen is the host's HudView (context).
     */
    lives: {
      window: { x: 60, y: 647, width: 960, height: 1050 },
      /** the popup's title, popup-local 166, −2 */
      title: { x: 226, y: 645, width: 628, height: 79, fontSize: 65 },
      /** `btn_close` render box (popup-local 847, −37) */
      close: { x: 907, y: 610, width: 153, height: 158 },
      /** `frame_blur_bg` render box (the instance at 140, 813, 800 × 520, blur 200; clipped by the frame at 0 / 1080) */
      inset: { x: 0, y: 613, width: 1080, height: 920 },
      heart: { x: 150, y: 904, width: 338, height: 338 },
      /** "56" 8:22844: Calibri Bold 140, stroke 5 */
      count: { x: 219, y: 993, width: 200, height: 160, fontSize: 140, stroke: { width: 5, color: 0x9b170b } },
      /** `txt` 8:22845 (vertical auto-layout, centred): "Next heart in" / "24:15", Calibri Bold 70 */
      nextLabel: { x: 488, y: 992, width: 442, height: 85, fontSize: 70, fill: 0x3f598c },
      timer: { x: 488, y: 1077, width: 442, height: 85, fontSize: 70, fill: 0x3f598c },
      refill: { x: 120, y: 1403, width: 354, height: 214 },
      /** "REFILL NOW" 8:22859: Calibri Bold 60 */
      refillLabel: { x: 144, y: 1431, width: 305.883, height: 105, fontSize: 60 },
      /** Frame 1244 8:22860: "900" 60 + 5 + the 46 coin (13 below the row top); the content's centre is 289.5, not the button's 297 */
      priceRow: { x: 289.5, y: 1510, height: 80, gap: 5, fontSize: 60 },
      coin: { width: 46, height: 46, y: 1523 },
      ad: { x: 500, y: 1403, width: 460, height: 214 },
      adHighlight: null,
      /**
       * "GET" 8:22852 (162 × 146 at 652, Calibri Bold 60): Figma's box runs under the tv (to 672) and the heart (from
       * 810); the slot is the free space between them around the same centre 733, so a longer word shrinks, never hides.
       */
      adLabel: { x: 672, y: 1437, width: 122, height: 146, fontSize: 60 },
      adIcon: { x: 522, y: 1435, width: 150, height: 150 },
      rewardIcon: { x: 810, y: 1446, width: 128, height: 128 },
      /** "1" 8:22855 (50 × 70 at 847, CENTER): the box widened to 100 around its centre 872, so "+1" fits; Calibri Bold 59.73, stroke 2 */
      rewardLabel: { x: 822, y: 1473, width: 100, height: 70, fontSize: 59.733, stroke: { width: 2, color: 0x9b170b }, align: 'center' }
    },
    /**
     * Settings 8:17493: boxes local to the popup box (40, 647 of the frame). The approved screen is the in-level one
     * (Restart level / Return home): `gameplay`. It has no haptic toggle. `map` (no game buttons) is not drawn in
     * Figma: the same window without the two action rows — the version moves up into their place (482) and the window
     * loses their 457 units. Text is Calibri Bold → Carlito, the labels and version #3f598c, the title and actions white.
     */
    settings: {
      offButtons: true,
      map: {
        window: { width: 1000, height: 593 },
        title: { x: 166, y: -18, width: 668, height: 110, fontSize: 90 },
        close: { x: 887, y: -37, width: 153, height: 158 },
        sound: {
          button: { x: 237, y: 220, width: 228, height: 228 },
          label: { x: 237, y: 147, width: 227, height: 73, fontSize: 60, fill: 0x3f598c },
          off: { x: 18, y: 15, width: 190, height: 190 }
        },
        music: {
          button: { x: 534, y: 220, width: 228, height: 228 },
          label: { x: 536, y: 147, width: 227, height: 73, fontSize: 60, fill: 0x3f598c },
          off: { x: 18, y: 15, width: 190, height: 190 }
        },
        haptic: null,
        version: { x: 89, y: 482, width: 822, height: 61, fontSize: 50, fill: 0x3f598c }
      },
      gameplay: {
        window: { width: 1000, height: 1050 },
        title: { x: 166, y: -18, width: 668, height: 110, fontSize: 90 },
        close: { x: 887, y: -37, width: 153, height: 158 },
        sound: {
          button: { x: 237, y: 220, width: 228, height: 228 },
          label: { x: 237, y: 147, width: 227, height: 73, fontSize: 60, fill: 0x3f598c },
          off: { x: 18, y: 15, width: 190, height: 190 }
        },
        music: {
          button: { x: 534, y: 220, width: 228, height: 228 },
          label: { x: 536, y: 147, width: 227, height: 73, fontSize: 60, fill: 0x3f598c },
          off: { x: 18, y: 15, width: 190, height: 190 }
        },
        haptic: null,
        /** `btn_main` (pad 50, gap 10, hug): icon 158 + 10 + the text, centred; the inner width 822 − 100 − 168 = 554. */
        restart: {
          button: { x: 89, y: 482, width: 822, height: 200 },
          label: { x: 314, y: 57.5, width: 362, height: 85, fontSize: 70 },
          icon: { x: 146, y: 21, width: 158, height: 158 },
          hug: { maxWidth: 554 }
        },
        /** The home icon's render box is 4 units wider than its 158 box on each side. */
        home: {
          button: { x: 89, y: 716, width: 822, height: 200 },
          label: { x: 304.5, y: 57.5, width: 381, height: 85, fontSize: 70 },
          icon: { x: 132.5, y: 21, width: 166, height: 158 },
          hug: { maxWidth: 554 }
        },
        version: { x: 89, y: 939, width: 822, height: 61, fontSize: 50, fill: 0x3f598c }
      }
    }
  },
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
