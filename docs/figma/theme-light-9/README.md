# Figma → Core: theme_light_9 (Style 2 gameplay row, No Ads entry art)

Source: file `5FWFwdO4QGeDfeQtloLNOS`, section `50:25954` `theme_light_9` — the LIGHT row (y 2583) is Style 2, the DARK
row (y 6052) Style 1. Read 2026-10-10 with read-only `use_figma` dumps and `get_screenshot` (`contentsOnly`) renders;
every number below names its node.

| Core | Style 2 (light) | Style 1 (dark) |
|---|---|---|
| MovesView (Style 2) | `orange_active` 50:28929 in `screen_gameplay` 50:28877 (PC 50:29212) | not changed (theme_light_6) |
| gameplay row host art (`boosterBack`, `lockedSlotBack`) | `booster_back` 50:29217, `btn_grey` 50:29225 (`screen_gameplay_pc` 50:29160) | not changed (theme_light_8) |
| feature column host art (`iconNoAds`, `featureGlow`, `featureSpark`) | `icons` 50:29480 of `screen_main_menu_pc` 50:29405 | `icons` 50:29603 of `screen_main_menu_pc_dark` 50:29520 |
| NoAdsWindowView | `screen_ads_off` 50:29087 = theme_light_6 28:48041, box for box (unchanged) | `screen_ads_off` 50:29111 (unchanged) |

```sh
node scripts/figma-assets.mjs docs/figma/theme-light-9          # writes the files below
node scripts/figma-assets.mjs docs/figma/theme-light-9 --check  # re-renders, compares with the committed files
```

## Files (Figma's own transparent renders, 1 px / unit, no text inside)

| role | file | from |
|---|---|---|
| Style 2 `movesPanel` | `style2/moves_tab.webp` 250 × 310 | `orange_active` 50:26381 (the component; the mobile instance is cut by the frame bottom): the #f9b72b → #ef6940 gradient down a radius-26.7 rectangle in a 5-unit grey ring. Declared a 9-slice in the skin (caps 36 / 36 / 36 / 40: corners, ring, inner shadows) — Figma resizes the tab (mobile 250 × 310, PC 300 × 480) and its gradient with it |
| Style 2 `boosterBack` | `style2/booster_diamond.webp` 289² | `booster_back` 50:29217 (component 50:26377: the 163 orange-rimmed square + the 130 white face, rotated 45°; the PC instance = the mobile 50:28934 × 1.2); render box = its rotated bounds 288.7 |
| Style 2 `lockedSlotBack` | `style2/locked_slot.webp` 241² | `btn_grey` 50:29225 of `btn_lvl` 50:29224 (the mobile 50:28942 200 × 1.2 = 240.1), no "Lvl 7", no lock |
| Style 2 `lockedSlotIcon` | `style2/nav_lock.webp` (reused) | `icon_lock` 50:26090 = the nav lock render (mean \|Δ\| 0.77) |
| Style 2 `levelEmblem` | `style2/level_node_open.webp` (reused) | `reward_stars_1` 50:28928 — the STARS alternative of the MOVES tab |
| Style 2 `iconNoAds` / `featureGlow` / `featureSpark` | `style2/icon_no_ads.webp` 250 × 252, `style2/feature_glow.webp` 384 × 274, `style2/spark.webp` 190² | `icon_no_ads` 50:26354, `blur_bg_3` 50:26300 (360 × 240 + 12 / 16.5 blur bleed), `pic_spark_1` 50:26242 |
| Style 1 `iconNoAds` / `featureGlow` / `featureSpark` | `level/style1_icon_no_ads.webp` 250², `level/style1_feature_glow.webp` 384 × 274, `level/style1_spark.webp` 42² | `icon_no_ads` 50:30494, `blur_bg_dark_3` 50:30497, `pic_spark_2` 50:30430 |

Superseded and removed: theme_light_6 `style2/moves_panel.webp` (the blue MOVES box) and theme_light_8
`style2/booster_back.webp` (the white popup square); `style2/locked_slot.webp` is re-rendered here (was 266 × 265).

## Gameplay row (host composition, frame units of the 1080 × 2344 mobile frame)

`screen_gameplay` 50:28877, group `bottom` 50:28927 (the field `game_field` ends at 2021). PC 50:29160 draws the same
row × 1.2 under its field.

- **Status block** — one of two alternatives in the same place (the artist: only one is shown at a time): the MOVES tab
  `orange_active` 250 × 310 at 44, 2078 (it runs 44 past the frame bottom; PC 300 × 480 runs 36 past) with "MOVES"
  Calibri Bold 50 at 64, 2098 (200 × 60) and the count 150 at 64, 2158 (200 × 140), white; or the STARS emblem
  `reward_stars_1` 250 at 40, 2021 (earned stars + the level number).
- **Locked slot** `btn_lvl` 50:28941: `btn_grey` 200 at 312, 2078, `icon_lock` 150 at 337, 2045 (33 above the button),
  "Lvl 7" Calibri Bold 60.8 white in 170 × 76 at 327, 2194.
- **Boosters** (wand first, then lamp): `booster_back` 170 rotated 45° — bounds 240.4 at 577, 2067 (wand) and 799, 2067
  (lamp), centres 697.2 / 919.2, 2187.2; `icon_wand` / `icon_lamp` 167.2 at 571, 2038 / 805.6, 2045.1 (centres −42.6,
  −65.6 / −30, −58.5 from the diamond's centre); the count "34" Calibri Bold 50.16 #3f598c, 66.9 × 51.8 centred 2 left
  of the diamond's centre, bottom-aligned 73.5 below it.

## Feature column (No Ads entry)

`screen_main_menu_pc` 50:29405 `icons` 50:29480: a vertical auto-layout column (pad 30, gap 60) at 3551, 492.5 (the
right edge 197 from the frame's), items 360 wide — the piggy bank preview, the daily tasks, the No Ads entry. The No
Ads item `icon_no_ads` 50:29487 (360 × 257): `blur_bg_3` 360 × 240 at 0, 12, `icon_no_ads` 250 at 55, 7, `pic_spark_1`
95 at 199, 0. Style 1 50:29608: the same boxes with `blur_bg_dark_3` and `pic_spark_2` 42. theme_light_9 has no phone
main menu: a host places the column under its top row at the right edge.

## No Ads window

`screen_ads_off` 50:29087 draws theme_light_6's boxes exactly (window 1000 × 1860 at 40, 202; the × 827, 15; rays,
hero 150, 450 700²; titles 100, 130 / 232; description 35, 1164 930 × 250; note 35, 1434; button 235, 1590 530 × 200;
"900" 70 + the 84 coin), so Core's styled NoAdsWindowView is unchanged. Its copy is the host's: ОТКЛЮЧЕНИЕ / РЕКЛАМЫ
(`wordNo` / `wordAds`), "Убирает Видео Рекламу" + "Оставляет награждаемую рекламу!" (`description`). Still not drawn
(theme_light_6 adaptations): the two `pic_spark_1` sparkles by the title and PoetsenOne (Carlito Bold instead).
