# Figma → Core: theme_light_6 Shop (the SHOP tab, `ShopScreen`)

Source: file `5FWFwdO4QGeDfeQtloLNOS`, section `28:45250` `theme_light_6`. Read 2026-10-08 with read-only `use_figma`
dumps and `get_screenshot` (`contentsOnly`) renders; every number below names its node.

| Core | Style 2 (light) | Style 1 (dark) |
|---|---|---|
| `ShopScreen` | `market_screen_light` 28:46095 (the family's other light frame 28:46120 swaps the × for two HUD bars) | `market_screen_dark` 28:46015 |

Both are phone frames (1080 × 2344, the iPhone status bar drawn into the frame: the awning reaches under it) of the
**SHOP tab**: the bottom navigation is visible with SHOP selected, the background is opaque, nothing is dimmed — a
screen, not a window. Core draws it as the non-modal `ShopScreen` next to `LevelMapScreen` (the host switches their
visibility); the modal `ShopWindowView` stays its donor self.

## Structure (frame units)

| Part | Style 2 28:46095 | Style 1 28:46015 |
|---|---|---|
| fill | #0f172c | GRADIENT_LINEAR top → bottom #5e2bd4 → #451262 + `bg_pattern_bears` 28:46016 (28 bears 129 × 128 in four 543-unit rows) + `Untitled-1 1` 28:46068 |
| awning | `Group 1237`: `Rectangle 65656` (#0a2259 0 → 100 % from 539 up to 335) under `Group 886` (2 × `pattern_markiza_smooth` 540 × 500: stripes 270 × 450, bottom radius 130); `shadow_up 1` (image tile 1080 × 506) under it | the same with `top_roof` (2 × `pattern_markiza_dark`) |
| × | `icon_close` 158 at 890, 222 (btn_red + glyph) = the popups' red × | `icon_close_dark` 120 at 921, 301 (inside `Group 1237`) = the No Ads × |
| title | `title_tape_blue` 1000 × 116 at 40, 493 + "SHOP" Calibri Bold 80 white (65, 512, 950 × 78) | `title_tape_blue_dark` 978 × 116 at 51, 493 (the component is 1000: stretched) + "SPECIAL OFFER" Fira Sans Black 60, 4 / 4 black outline (111, 503, 858 × 78) |
| cards | `market_card_blue_1` 310 × 406 at 51 / 385 / 719 × 629 / 1061 | `market_card_blue_1_dark` 310 × 406 at 51 / 385 / 719 × 633 / 1063 |
| card amount | Calibri Bold 60 #3f598c at 9.76, 31, 290 × 73 | Fira Sans Black 60 white, 4 / 4 outline at 9.76, 31, 290 × 72 |
| card pack | `icon_coin_2..7` 260 × 220 at 25, 86 | `icon_coin_dark_2..7` 260 × 220 at 25, 86 |
| card price | white 60 (soft 30 % shadow) in `amount` 88.26, 312, 134 × 70 | white 56, 4 / 4 outline in `number` 88.26, 312, 134 × 70 |
| scroll | `Frame 615` 40, 493, 1000 × 1501 (title + grid), ends at 1994 = 64 above the panel rect (2058) | — (the same layout) |
| nav | `bottom_panel` + `navigation_shop / home / lock` (352 × 396 at 6 / 364 / 722, 1948) | the dark nav components |

Each card hides an `icon_128/crysta` (71 × 71) next to its price (a crystal price): hidden in every card, not drawn.

## Rasters

Figma's own transparent renders in `png/` (no text inside: titles, amounts and prices are runtime), composed at their
Figma offsets by the existing pipeline:

```sh
node scripts/figma-assets.mjs docs/figma/theme-light-6-shop          # writes the files below
node scripts/figma-assets.mjs docs/figma/theme-light-6-shop --check  # re-renders, compares with the committed files
```

| Core role | Style 2 file | Style 1 file |
|---|---|---|
| `shopBackground` | — (the fill only) | `shop/style1_background@0.5x.webp`: the gradient (`svg/style1-background-gradient.svg`, written from the frame fill) + the bears |
| `shopAwning` | `style2/shop_awning.webp` 1080 × 539 | `shop/style1_awning.webp` 1080 × 539 |
| `shopTitle` | `style2/shop_title.webp`: 28:45524 (render 1008 × 118) | `shop/style1_title.webp`: 28:48587 + 28:48588 on the 1000 × 116 component box |
| `shopCard` | `style2/shop_card.webp`: base_blue 28:45350 + base_white 28:45351 (322 × 418) | `shop/style1_card.webp`: base 28:49390 (318 × 418) |
| `shopPack1..6` | `style2/shop_pack_1..6.webp` (28:45464 / 45462 / 45460 / 45458 / 45456 / 45466) | `shop/style1_pack_1..6.webp` (28:49156 / 49146 / 49148 / 49150 / 49152 / 49154) |
| `shopClose` | `style2/settings_close.webp` (reused: the same art) | `offer/style1_noads_close.webp` (reused: the same component 28:48843) |

The title tapes have shaped ends (no uniform row), so they are 9-slices along x only: `nineSlice.axis: 'x'` in
`figma.json` keeps every row and splits the height into two caps (the pipeline's one addition for this pass).

## Adaptations (not from Figma)

- The title is runtime copy: the default is Core's `core.shop.title` (SHOP / МАГАЗИН) for both styles; Figma's dark
  sample "SPECIAL OFFER" is host copy (`title`).
- Amounts are drawn as given digits (Figma: `1000`, `12500` — no thousands separator); prices are the host's strings.
- Style 2's price soft shadow (blur 10, 30 %) is not drawn (Core's text look has the OUTSIDE stroke and the hard shadow).
- The frame's top edge is the viewport's top edge (the awning under the status bar, like the phone frame); the × never
  goes above the safe top and keeps Figma's distance from the safe area's right edge, so on a wide desktop viewport it
  sits in the corner while the awning tiles and the background cover the width. The Style 1 picture is cover-fit (on a
  wide viewport the bears grow with it).
- A last row with fewer than three cards is centred; packs past the sixth reuse `shopPack6` (a host may pass its own
  texture per item).
- No entrance motion: a tab switch is instant (Figma specifies none).
