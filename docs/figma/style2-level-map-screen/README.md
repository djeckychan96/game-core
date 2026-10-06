# Figma → Core: Style 2 LevelMap screen

Source: file `5FWFwdO4QGeDfeQtloLNOS`, section `8:17492` `theme_light_3`, screen `8:23174` `screen_gameplay_pc`
(4168 × 2344, inside section `8:17771`; its components live in `8:17503` «компоненты для художников»).
Read 2026-10-01. Only `8:23174` and the child nodes listed in `figma.json` (`approvedNodes`) are a source; the
other screens, the hidden layers and the older variants that still lie in `theme_light_3` are not (`ignored`).

- `figma.json` — the read: node ids, boxes, render boxes, fills, effects, text styles, what each became in Core, the
  asset pipeline spec;
- `png/` — Figma's own transparent renders of the static leaf visuals (no text, no sample values inside);
- `svg/` — Figma's SVG exports of the same nodes with the page / section / screen fills removed, kept as the vector
  reference (gradients, filters). They are NOT rasterised: Chrome draws some Figma effects differently (the plus
  glyph's drop shadow: mean |Δ| 9.4 against Figma's render);
- `reference/screen-8-23174@0.5x.webp` — Figma's render of the whole screen (1x PNG sha256 `c32643a6…f374a`),
  downscaled, lossy, for the parity check.

## Use

```ts
import { LevelMapScreen, READY_UI_STYLE_2, loadReadyUiAssets } from 'game-core/pixi';

const READY_UI_THEME = {
  skin: READY_UI_STYLE_2,
  // the host's map spacing, read from 8:23174 (theme.levelMap stays the host's, the scroll code is shared)
  levelMap: { badgeSize: 288, nodeScale: 1, levelGap: 402, focusBoost: 4 / 3, focusRatio: 1260 / 2344, contentScale: 1 }
};
const textures = await loadReadyUiAssets({ baseUrl, skin: READY_UI_THEME.skin }); // + fonts/Carlito-Bold.woff
const screen = new LevelMapScreen({
  ui, motion, textures, i18n, theme: READY_UI_THEME,
  map: { levels, currentLevel, onSelectLevel },
  hud: { coins, lives, maxLives, stars, onLivesTap, onCoinsTap },
  nav: { items: [{ id: 'shop', icon: 'iconShop', labelKey: 'game.nav.shop' }, { id: 'home', icon: 'iconHome', labelKey: 'game.nav.home' }, { id: 'events', locked: true }], selectedId: 'home', onSelect: route },
  onPlay: (level) => startLevel(level)
});
```

No skin → every view donor, exactly as before; Style 1 is unchanged. `HudView`, `LevelMapView` and `BottomNavView`
can also be used alone with the same theme.

## Rasters

`download_assets` PNG exports of nodes without export settings are rendered **in context** (page `#F5F5F5`, section
`#444444`, the screen gradient) and come out fully opaque — the same trap as Style 1's glow. `get_screenshot` with
`contentsOnly` returns the same render WITH alpha: composited over the context colour it equals the opaque export
(mean |Δ| 0.005–0.4), so `png/` holds those renders. The icon components carry the artist's PNG@1x export settings;
their exports are transparent and used as they are.

```sh
node scripts/figma-assets.mjs docs/figma/style2-level-map-screen          # writes assets/pixi-ui/style2/*.webp
node scripts/figma-assets.mjs docs/figma/style2-level-map-screen --check  # re-renders, compares with the committed files
```

| Core role | file | from |
|---|---|---|
| `levelNodeNormal` (open: current + completed) | `level_node_open.webp` 384² | `stars_base` 8:17658 at its render origin (0, 2.797) + empty slots 8:17660 at (0, 18.43), the 384 component box clips (fractional placement matched Figma's composite best: mean 0.40 vs 0.55–0.95 rounded) |
| `levelNodeLocked` | `level_node_locked.webp` 288² | 8:17671 at (0, 2.098) + 8:17673 at (0, 13.82) |
| `levelStarGold` / `hudStar` | `icon_star.webp` 288² | `icon_star_1` 8:17647 |
| `levelStarGoldL` / `R` | `level_star_l/r.webp` 174 × 198 | the render of 8:17667 (`F·R(30)` of the image) and its mirror (= the hidden right star `R(30)`) |
| `levelLock` (and `navLock` until theme_light_5: now `nav_lock.webp`, docs/figma/theme-light-5-level-map-nav) | `icon_lock.webp` 288² | `icon_lock` 8:17651 |
| `levelRail` | `level_rail.webp` 80 × 32 | 32 rows from the middle of `pic_light_ray` 8:23222 (uniform within the ±3 dither) |
| `levelMapBackground` | `bg_sky.webp` 1672 × 941 | the raw `bg_2` image (sha1 = imageHash `8516046e…`), `cwebp -q 90`, 46 KB |
| `hudCapsule` | `hud_capsule.webp` 515 × 182 | `header_back` 8:17609 (its bar clips the right shadow, kept) |
| `hudHeart` / `hudCoin` | `icon_heart.webp` / `icon_coin.webp` 288² | 8:17643 / 8:17641 |
| `hudPlus` | `hud_plus.webp` 114² | `icon_plus_1` 8:17683 |
| `playButton` | `play.webp` 550 × 280 | `btn_green` 8:23224 (no wings, labels runtime) |
| `navPanel` | `nav_panel.webp` 8 × 296, 9-slice 0 / 20 / 0 / 14 | the centre columns of `bottom_panel` 8:17713 |
| `navSelected` | `nav_selected.webp`, 9-slice 56 / 58 / 57 / 2 (measured, tolerance 3) | `blue_active` 8:23254 |
| `iconShop` / `iconHome` | 288² | `icon_market` 8:17635 / `icon_home` 8:17633 |

Text: Figma's Calibri Bold is proprietary → **Carlito Bold** (OFL 1.1, metric-compatible): `fonts/Carlito-Bold.woff`
is the unchanged Bold face of macOS FontServices `Carlito.ttc` wrapped as WOFF 1.0 (zlib per table, no WOFF
metadata: not a Modified Version per the OFL FAQ, so the Reserved Font Name stays), license in
`fonts/Carlito-OFL.txt`. White, no stroke, no shadow; the HUD counters `#3f598c`.

## Geometry (frame units; the frame is 2344 high like the kit's design box)

| part | Figma | Core |
|---|---|---|
| HUD | three `icon_bar` 582 × 236 at 60 / 670 / 1280, y 60; icon 236, capsule render 67, 27, 515 × 182, text box 233, 69, 300 × 98 @80, plus 114 at 146, 109 (not on stars) | `hud` layout; no gear (`gear: null`), no count in the heart (`heartCount: null`), no area rule (`responsive: null`: Figma size, shrunk only to fit the width) |
| nodes | blue 288 (centres 834, 456), orange 384 = 288 × 4/3 at the focus (centre 1260); number "25" @75 at +31, "3" @140 at +80.5 (×0.75 → @105, +60.4); lock 86.4 at +100 | open / locked art + number boxes; the orange size is the host's `focusBoost: 4/3` |
| rail | 80 wide, centre x 2086, from the top to under the current node | `levelRail` per segment |
| PLAY | 550 × 280 centred at 2084, 1762; "PLAY" @120, "Level N" @70 | `levelMapScreen.play`: 296 units above the nav panel top |
| nav (superseded by theme_light_5: docs/figma/theme-light-5-level-map-nav) | panel rect 0, 2058, 4168 × 286; slots 1457.4 / 2122 / 2785; selected column 1275.2, 2030, 364.3 × 314; selected icon 288 at y 2092, "SHOP" @60; normal icon 220 at 2144, "HOME" @40; locked: lock 220.3 at 2152, no label | `bottomNav`: pitch 664 centred on the viewport |

## Implementation adaptations (not from Figma)

- **Map spacing** is the host's `theme.levelMap` (above): one gap of 402 puts the second locked node exactly at 456
  (the first at 858 instead of 834: Figma's two gaps are 426 and 378, Core has one).
- **Nav slots** are centred on the viewport; Figma's group is centred on its bounding box, so its slots sit 37.5 units
  (≈ 13 px at 1280 × 800) to the right.
- **Narrow screens**: the HUD row keeps Figma's size and shrinks to fit the width; nav slots shrink to `width / N` (an
  item scales only when its selected column no longer fits its slot); PLAY stays 296 units above the nav; the map
  runs from the top inset down to PLAY; the sky is cover-fit and centred (Figma's `bg_2` rect sits 10 units higher).
- **Runtime over sample**: node stars come from the level data (Figma shows 2 earned stars on the current node and a
  gold star on every locked one); counters use Core's `formatAmount` (`9 990`, Figma `9990`); a completed level under
  the current one is part of the scrolling ribbon (Figma draws none).
- **No HARD art** in 8:23174: a hard level draws like a normal one under Style 2.
