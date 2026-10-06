# Figma → Core: LevelMap PLAY + bottom navigation (theme_light_5, Style 1 and Style 2)

Source: file `5FWFwdO4QGeDfeQtloLNOS`, section `24:35889` `theme_light_5` — the only current snapshot for the LevelMap
screen's PLAY and navigation (theme_light_3 / theme_light_4 are superseded for these parts). Read 2026-10-06; every
node, box, fill and effect is in `figma.json`.

- **Style 1** (purple): PLAY `24:37523` and the nav `24:37548` in the main screen `24:37472`; the slot art is the dark
  nav components `navigation_shop_dark` `24:38867`, `navigation_home_dark` `24:38858`, `navigation_lock_dark` `24:38849`
  (states `active` / `inactive`) with the icons `24:38641` / `24:38820` / `24:38823`.
- **Style 2** (light): `screen_gameplay_pc` `24:38532` — PLAY `24:38581`, `bottom_panel` `24:38607`, the slots
  `24:38610` / `24:38609` / `24:38608`; the light component strip `24:36128`.

## One functional contract

Both styles draw the same `LevelMapScreen`: select a level (scroll, or tap its node) → PLAY → `onPlay(level)`, and the
navigation's three slots SHOP | HOME | LOCK → their `onTap` (HOME selected; LOCK in the style's locked state; a slot
without `onTap` disabled). The styles only change files, boxes, captions' look and the PLAY level line.

## Rasters

Figma's own renders, no text inside (captions are runtime): the icon components' PNG@1x exports (transparent), and
`get_screenshot` with `contentsOnly` for the rest (transparent where the node has transparency).

```sh
node scripts/figma-assets.mjs docs/figma/theme-light-5-level-map-nav          # writes the files below
node scripts/figma-assets.mjs docs/figma/theme-light-5-level-map-nav --check  # re-renders, compares with the committed files
```

| Core role | file | from |
|---|---|---|
| Style 1 `playButton` | `button/style1_play.webp` 522 × 228 | PLAY `24:37524` (`Group 189`): its render box, stroke and shadow included |
| Style 1 `navPanel` | `nav/style1_panel.webp` 8 × 292, caps 0 / 8 / 0 / 2 | the centre columns of `24:37551`: 6 rows of the #261a30 stroke, then the #303e8f → #222a5d gradient |
| Style 1 `navSelected` | `nav/style1_selected.webp` 364 × 314, caps 60 / 64 / 60 / 2 | `blue_active_dark` `24:38870` without the stroke under it; rows uniform from 62 |
| Style 1 `iconShop` / `iconHome` / `navLock` | `nav/style1_icon_shop.webp` / `_home` / `_lock` 288² | `icon_shop_dark` / `icon_house_dark` / `icon_lock_dark` |
| Style 2 `navLock` | `style2/nav_lock.webp` 288² | `icon_lock` `24:36028` (the map's `levelLock` keeps `style2/icon_lock.webp`) |

Style 2's PLAY, panel, selected column and SHOP / HOME icons were checked against theme_light_5 and are unchanged
(pixel-identical renders; the column 0.52 mean |Δ|, the same art).

## Geometry (design units; nav x from the slot centre, y from the panel rect top)

| part | Style 1 | Style 2 |
|---|---|---|
| PLAY | 522 × 228 render box, centre 286 above the panel; "PLAY" Fira Sans Black 110, the kit's 4 / 4 outline; **no level line** | unchanged: 550 × 280, 296 above; "PLAY" 120 + "Level N" 70, Carlito |
| panel | 286 high, 6 bleed (the stroke) | unchanged: 286, 10 bleed |
| pitch | 364 (the 24:36128 strip: 352 slots 12 apart) | 664 (centres 1420 / 2084 / 2748, on the frame's centre now) |
| selected (HOME) | column −182, −28, 364 × 314; icon 288 at 51; caption 284 × 70 at 195, 54 | column unchanged; icon 288 at 43; caption 284 × 70 at 173, 60 |
| normal (SHOP) | icon 220 at 98; caption 352 × 74 at 189, 40 | icon 267.034 at 93.517; caption 352 × 74 at 180, 40 |
| locked (LOCK) | lock icon 220 at 98; caption "LOCK" 352 × 74 at 189, 40 | lock icon 267.034 at 97.517; caption "LOCK" 352 × 74 at 181.059, 40 (new in theme_light_5) |
| caption look | white Fira Sans Black, 3-unit OUTSIDE #261a30 stroke, 4-unit #261a30 shadow (`bottomNav.text`) | white Carlito, plain |

## Implementation adaptations (not from Figma)

- **One layout per state**: Figma's variants differ by a few units per slot (Style 1 HOME inactive icon 3 units higher;
  Style 2 actives at y 43 / 44 and HOME's caption 1 unit right). Core has one box per state: SHOP's inactive numbers
  for `normal`, LOCK's for `locked`, HOME's for `selected` (centred).
- **Narrow screens**: slots keep Core's shrink-to-fit rule (`pitch = min(pitch, width / 3)`): on a 1080-wide phone the
  Style 1 slots are 360 apart (Figma's strip 364, its outer slots touching the edges).
- **No disabled art** in either style: a disabled slot keeps its look and is inert (HudView's gear rule).
- **Captions are runtime**: `core.nav.shop` / `core.nav.home` / `core.nav.lock` (EN SHOP / HOME / LOCK, RU МАГАЗИН /
  ДОМОЙ / ЗАКРЫТО), or the host's label.
- The Style 1 screen's own HOME bear and lock group (`24:37580`, `24:37554`) are older drawings; the components are the
  current art. The rest of theme_light_5 (map nodes, HUD, windows) is not part of this read.
