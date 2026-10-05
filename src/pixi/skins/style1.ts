import type { ReadyUiOptionalTextureName } from '../assets';
import type { ReadyUiSkin, ReadyUiSkinRole } from '../skin';

/**
 * Style 1 — the Figma "HAMSTER PIXEL FLOW" Ready UI.
 *
 * theme_light_4 (file 5FWFwdO4QGeDfeQtloLNOS, section 22:26884, the purple row; docs/figma/style1-theme-light-4) is the
 * current snapshot: Lives 22:27562 (shorter window), the OFFER panel under Lives / Restart (22:28069 / 22:28122),
 * Settings 22:28430 (toggle row centred, SETTINGS 100, plain version, violet ×); Exit 22:28232 and WIN 22:28251 are
 * the boxes below unchanged.
 *
 * COVERS: `confirm` (screen/confirm-exit 820:77655, docs/figma/confirm-exit) and `lives` (screen/lives 85:8944,
 * docs/figma/lives), the current runtime surface of `settings`, HUD and LevelMap from the canonical level-select
 * screens (file sJ0BV1ARqMpcj5dZbjFppz, desktop 1:911 / mobile 1:1301), and the level `result` WIN / FAIL
 * (screen/result-win 1:3854, screen/result-fail 1:4029, docs/figma/style1-result). NOT COVERED — donor look: Shop,
 * NoAds, StarterPack (no Style 1 screen exists for them).
 *
 * Every number is the Figma read (unchanged from the `variant: 'figma'` windows): boxes in design units of the
 * 1080 × 2344 frame, art boxes = the SVG export (render) boxes. The files are the ones Core already ships under
 * `assets/pixi-ui/` (rendered by `node scripts/figma-assets.mjs`, no text inside any of them); the 9-slice caps are
 * measured on those rasters: the Figma @stretch insets plus the art's bleed, grown where an effect or a corner reaches
 * into the stretch area, plus an 8-unit gutter at every seam (docs/figma/confirm-exit/README.md lists the numbers).
 */
export const READY_UI_STYLE_1 = {
  id: 'style-1',
  covers: ['confirm', 'lives', 'settings', 'hud', 'levelMap', 'result'],
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
    /** Result `action/close` (its 51 × 51 box), tinted for the ribbon it sits on. */
    resultCloseWin: { file: 'result/style1_close_win@2x.webp' },
    resultCloseFail: { file: 'result/style1_close_fail@2x.webp' },
    /** Result `Rectangle 218`: the blurred band behind the reward / the broken heart (its full render box, not cut at the frame). */
    resultGlowWin: { file: 'result/style1_glow_win@0.5x.webp' },
    resultGlowFail: { file: 'result/style1_glow_fail@0.5x.webp' },
    /** Result `icon_coin_128` at 256: the reward coin (render box). */
    rewardCoin: { file: 'result/style1_reward_coin@2x.webp' },
    /** Result FAIL EXIT (no Figma node): Style 1's RETURN HOME surface — the gameplay Settings home button art. */
    buttonExit: { file: 'settings/btn_home.webp' },
    /** theme_light_4 OFFER panel (22:28069 / 22:28122): the same `Component 9` window shell at 960 × 640 — the window file and caps. */
    offerPanel: { file: 'window/window_base@2x.webp', nineSlice: { left: 92, top: 187, right: 92, bottom: 110, pad: { left: 4, top: 4, right: 4, bottom: 8 } } },
    /** `icon_sale` 22:28091 without its text: the red burst turned −30° (docs/figma/style1-theme-light-4). */
    offerBadge: { file: 'window/style1_offer_badge@2x.webp' },
    /** `icon_heart` 22:28071 without its caption: the Lives heart with the ∞ glyph (unlimited lives). */
    offerLivesArt: { file: 'icons/style1_offer_lives@2x.webp' },
    /** `icon_coin` 22:28125 without its amount. */
    offerCoinArt: { file: 'icons/style1_offer_coin@2x.webp' }
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
     * theme_light_4 `настройки гл экран` 22:28430 (Component 9 960 × 1090 at 60, 627): the toggle row sits centred in
     * the body — labels at 391, buttons at 478 (before: 204 / 291, with the legacy controls under them); the version
     * stays at 994. theme_light_4 has no Style 1 in-level screen: `gameplay` keeps its rule — the map window with the
     * action rows inserted above the version — so its toggle row follows the map's. SETTINGS is 100 (the other
     * windows' titles 80); the version #716dd0 40 is plain (no stroke / shadow).
     */
    settings: {
      /** map-a / map-b collapse to the one current map layout; their unsupported legacy controls are not represented. */
      map: {
        window: { width: 960, height: 1090 },
        title: { x: 135, y: 34, width: 690, height: 104, fontSize: 100 },
        close: { x: 863, y: 61, width: 51, height: 51 },
        sound: {
          button: { x: 62, y: 478, width: 224, height: 220 },
          label: { x: 77, y: 391, width: 194, height: 72, fontSize: 60 },
          off: { x: 32.5, y: 29, width: 159, height: 162 }
        },
        music: {
          button: { x: 368, y: 478, width: 224, height: 220 },
          label: { x: 393, y: 391, width: 174, height: 72, fontSize: 60 },
          off: { x: 32.5, y: 29, width: 159, height: 162 }
        },
        haptic: {
          button: { x: 674, y: 478, width: 224, height: 220 },
          label: { x: 688, y: 391, width: 197, height: 72, fontSize: 60 },
          off: { x: 32.5, y: 29, width: 159, height: 162 }
        },
        version: { x: 267, y: 994, width: 439, height: 48, fontSize: 40, outline: false }
      },
      gameplay: {
        window: { width: 960, height: 1576 },
        title: { x: 135, y: 34, width: 690, height: 104, fontSize: 100 },
        close: { x: 863, y: 61, width: 51, height: 51 },
        sound: {
          button: { x: 62, y: 478, width: 224, height: 220 },
          label: { x: 77, y: 391, width: 194, height: 72, fontSize: 60 },
          off: { x: 32.5, y: 29, width: 159, height: 162 }
        },
        music: {
          button: { x: 368, y: 478, width: 224, height: 220 },
          label: { x: 393, y: 391, width: 174, height: 72, fontSize: 60 },
          off: { x: 32.5, y: 29, width: 159, height: 162 }
        },
        haptic: {
          button: { x: 674, y: 478, width: 224, height: 220 },
          label: { x: 688, y: 391, width: 197, height: 72, fontSize: 60 },
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
        version: { x: 267, y: 1476, width: 439, height: 48, fontSize: 40, outline: false }
      }
    },
    /**
     * Figma `screen/result-win` 1:3854 / `screen/result-fail` 1:4029 (docs/figma/style1-result): frame boxes. The hero art
     * above the ribbon (art/result-*-hero: a trophy, the game's bear) is game content and not part of the style; the WIN
     * star crown keeps that place.
     */
    result: {
      win: {
        /** ui/ribbon/title red 1:4024: the 815 × 203 band at 133, 735; render box with the tails and the shadow */
        ribbon: { x: 31, y: 731, width: 1019, height: 239 },
        /** the ribbon's text layers: Fira Sans Black 90 / 70, CENTER / CENTER */
        title: { x: 133, y: 743, width: 816, height: 104, fontSize: 90 },
        subtitle: { x: 133, y: 847, width: 816, height: 70, fontSize: 70 },
        /** action/close 1:4025 */
        close: { x: 957, y: 775, width: 51, height: 51 },
        /** Rectangle 218 1:3955: 956 × 316 at 62, 1003, layer blur 225.7 */
        glow: { x: -163.7, y: 777.3, width: 1408, height: 768 },
        /**
         * No Figma node (the hero's place): Core's WIN crown at the donor offsets from the ribbon's top edge — the Style 1
         * ribbon's render box is the donor ribbon's 1019 × 239 — centred on the ribbon (540.5).
         */
        stars: [
          { x: 268.5, y: 627.5, size: 240 },
          { x: 540.5, y: 567.5, size: 288 },
          { x: 812.5, y: 627.5, size: 240 }
        ],
        /** REWARDS 1:3974: Fira Sans Black 50 */
        rewardsLabel: { x: 319, y: 973, width: 442, height: 60, fontSize: 50 },
        /** icon_coin_128 1:3958 (256 box at 412, 1023): the coin's render box */
        coin: { x: 442, y: 1051, width: 196, height: 210 },
        /** 1:3973 "500": Fira Sans Black 80, hugging, centred at 540.5, 1271 */
        amount: { x: 340.5, y: 1223, width: 400, height: 96, fontSize: 80 },
        /** 1:3978 ui/button/surface green + CONTINUE (Fira Sans Black 60) */
        next: { button: { x: 90, y: 1375.5, width: 439, height: 207 }, label: { x: 22, y: 13, width: 398, height: 159, fontSize: 60 } },
        /** 1:3981 ui/button/surface orange + its highlight; the runtime RETRY label in CONTINUE's box (Figma's x2 offer is not Core's) */
        retry: { button: { x: 551, y: 1375.5, width: 439, height: 207 }, label: { x: 22, y: 13, width: 398, height: 159, fontSize: 60 }, highlight: { x: 8, y: 5, width: 307, height: 172 } }
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
