# Figma → Core: Style 2 Refill Hearts

> **Superseded (2026-10-05)** by the theme_light_4 read in [docs/figma/style2-theme-light-4](../style2-theme-light-4/README.md): this folder records the earlier theme_light_3 snapshot only.

Source: file `5FWFwdO4QGeDfeQtloLNOS`, section `8:17492` `theme_light_3`, screen `8:22838` `screen_refill_hearts`
(1080 × 2344); leaf components from `8:17503` «компоненты для художников». Read 2026-10-02. **Provisional approved
snapshot**: the artist is still working on Style 2; this is what the current implementation follows, not a frozen style.

- `figma.json` — the read: node ids, boxes, fills, text styles, what each became in Core, the reused files and their
  equivalence numbers, the sample values that are NOT baked, the asset pipeline spec;
- `png/` — the `figma-assets` inputs: Figma's own transparent renders of the leaves (`get_screenshot`, `contentsOnly`)
  — `btn-green-8-22858.png`, `btn-yellow-8-22851.png`, `icon-tv-8-17637.png` — the glow at 0.5x
  (`glow-8-22841@0.5x.png`, the 1x render box-filtered) and the price coin's raw 256 × 256 image fill;
- `render/popup-8-22840.png` — Figma's render of the popup instance (title and × included): the proof that the reused
  Settings panel + close are the same pixels;
- `reference/screen-8-22838@0.5x.webp` — Figma's render of the whole screen, downscaled, lossy, for the parity check.

## Use

```ts
import { LivesWindowView, READY_UI_STYLE_2, formatTimer, loadReadyUiAssets } from 'game-core/pixi';

const textures = await loadReadyUiAssets({ baseUrl, skin: READY_UI_STYLE_2 }); // once, for every Style 2 view
const refill = new LivesWindowView({
  ui, motion, textures, i18n, theme: { skin: READY_UI_STYLE_2 }, id: 'refill',
  onRefill: (p) => buyRefill(p.refillPrice), onWatchAd: () => showRewarded('life')
});
refill.show({ lives, maxLives, timerText: formatTimer(secondsToNext), refillPrice }); // LivesRuntime / the economy
refill.setTimer(formatTimer(secondsToNext));                                          // while open
```

Same params, actions and states as every Lives window: MAX + REFILL disabled at full lives, the rewarded button only
when offered and handled (REFILL then centred), continuations after the close. The top resource HUD of the sample
screen is the host's `HudView` (Style 2 `hud`), not part of the popup.

## Core mapping (`windows.lives`, frame coordinates)

| Figma | Core | file |
|---|---|---|
| `popup` 8:22840 (the Settings popup at 960 × 1050) | `windowSurface` (9-slice 191 / 167 / 191 / 88, pad top 49) | `style2/settings_panel.webp` — **reused** |
| its `btn_close` (render 907, 610) | `windowClose` 153 × 158 | `style2/settings_close.webp` — **reused** |
| `frame_blur_bg` 8:22841 (render 0, 613, 1080 × 920) | `panelInset` (caps 0) | `style2/lives_glow@0.5x.webp` — new |
| `icon_heart_1` 338 / 128 | `lifeArt` / `rewardIcon` | `style2/icon_heart.webp` — **reused** (the HUD heart) |
| `btn_green` 8:22858 354 × 214 | `buttonPrimary` (9-slice 48 / 103 / 48 / 103) | `style2/button_primary.webp` — new |
| `btn_yellow` 8:22851 460 × 214 | `buttonRewarded` (same caps); `adHighlight: null` | `style2/button_rewarded.webp` — new |
| `icon_tv_1` 8:17637 at 150 | `adIcon` | `style2/icon_tv.webp` — new |
| `icon_coin` 8:22862 46 × 46 | `priceIcon`, `coin.y` 1523 | `style2/price_coin@2x.webp` — new |
| title 65 white / `Next heart in` + timer 70 `#3f598c` / count 140 white + `#9b170b` 5 / `REFILL NOW`, `900`, `GET` 60 white / reward 59.7 white + `#9b170b` 2 | runtime text, Carlito; per-box `fill` / `stroke` / `align` | `fonts/Carlito-Bold.woff` — reused |
| Frame 1244: `900` + 5 + coin, content centre 289.5 | `priceRow` (`x` 289.5: Figma's row is 7.5 left of the button centre) | — |

Reuse proof: the Settings panel 9-slice drawn at 960 × 1050 with the close over it vs `render/popup-8-22840.png`
(title box excluded): mean |Δ| 0.09, max 31 at the ×'s lower-left (the Settings check had the same max 31); the 5
columns the Settings close lacks are fully transparent here. The price coin at 2 px / unit, box-filtered to 46,
matches Figma's 46 render (mean |Δ| 0.55).

```sh
node scripts/figma-assets.mjs docs/figma/style2-refill-hearts           # png/ → assets/pixi-ui/style2/{button_*, lives_glow, icon_tv, price_coin}
node scripts/figma-assets.mjs docs/figma/style2-refill-hearts --check    # re-renders, compares with the committed files
```

## Implementation adaptations (not from Figma)

- **Reward label**: Figma's sample is `1` in a 50-unit box; the runtime default stays `+1` (`adRewardLabel`), so the box
  is widened to 100 around the same centre (872) and centred.
- **GET slot**: Figma's 162-unit box overlaps the tv icon (to 672) and the reward heart (from 810); Core uses the free
  space between them around the same centre (672, 122 wide), so a longer localized word (`ВЗЯТЬ`) shrinks instead of
  running under the icon. `GET` itself is unchanged.
- **Copy**: the existing keys — `core.lives.title / next / refill / ad_action` (EN `REFILL HEARTS!`, `Next heart in`,
  `REFILL`, `GET`; RU `ЖИЗНИ`, `Новая жизнь через`, `ПОПОЛНИТЬ!`, `ВЗЯТЬ`). Figma's `REFILL NOW` is sample copy;
  `?figma=1` on the showcase page passes it as explicit host text.
- **Heart**: the 288 raster drawn at 338 (×1.17) — the same art as the HUD heart, no second file.

## When the artist changes it

1. A read-only dump of `8:22838` (boxes, fills, text styles, main components): compare with `figma.json`.
2. Re-render the screen and the changed leaves (`get_screenshot` `contentsOnly` of the plain-id nodes above); diff with
   `reference/` and `png/`. A changed leaf → replace its `png/` input and run `figma-assets`; a moved box → edit
   `windows.lives` in `src/pixi/skins/style2.ts`; a changed popup → re-check it against the Settings panel.
3. `npm run showcase:style2-windows` prints the region parity against the new reference.
