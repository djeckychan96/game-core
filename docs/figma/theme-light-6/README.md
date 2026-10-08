# Figma → Core: theme_light_6 P0 / P1 sync (Result WIN, Moves, settings button, No Ads)

Source: file `5FWFwdO4QGeDfeQtloLNOS`, section `28:45250` `theme_light_6` — the only source for this pass (theme_light_5
and older are not read). «Окна на переделку» `28:45813`: the LIGHT row (y 2583) is Style 2, the DARK row (y 6052) is
Style 1. PC screens are 4168 × 2344 with the mobile unit size: a PC box maps into Core's 1080 × 2344 frame by
`x − 1544` (y unchanged). Read 2026-10-08 with read-only `use_figma` dumps and `get_screenshot` (`contentsOnly`)
renders; every number below names its node.

| Core | Style 2 (light) | Style 1 (dark) |
|---|---|---|
| ResultWindowView WIN | `screen_victory_pc` 28:48352 (mobile 28:47932) | `screen_victory_pc_dark` 28:48286 (mobile `победа` 28:46750) |
| MovesView | MOVES `Group 1358` 28:48175 in `screen_gameplay_pc` 28:48114 | MOVES `Group 1356` 28:48247 in `screen_gameplay_pc_dark` 28:48205 |
| SettingsButtonView | `btn_settings` 28:48119 (and 28:48358 on the WIN) | `btn_settings` 28:48211 (and 28:48292 on the WIN) |
| NoAdsWindowView | `screen_ads_off` 28:48041 | `screen_ads_off` 28:48065 |

## Rasters

Figma's own transparent renders (no text inside; captions, numbers and prices are runtime) in `png/`, turned into the
Core textures by the existing pipeline:

```sh
node scripts/figma-assets.mjs docs/figma/theme-light-6          # writes the files below
node scripts/figma-assets.mjs docs/figma/theme-light-6 --check  # re-renders, compares with the committed files
```

| Core role | file | from |
|---|---|---|
| Style 2 `resultRibbonWin` / `resultRibbonFail` | `style2/result_ribbon.webp` 1020 × 226 | `pic_tape_red` 28:45448: one image fill, no text; render box = node box |
| Style 2 `resultGlowWin` | `style2/result_rays@0.5x.webp` 917 × 893 (1833 × 1785 units) | `rayes` 28:48361: the 8-ray radial burst (opacity 0.5, blur 40) + 13 translucent stars; = mobile `pic_decor_1` 28:45527 |
| Style 1 `resultCloseWin` | `result/style1_close_dark@2x.webp` 50 × 50 | `icon_close_dark_2` 28:49423 inside the dark ribbon: the same × glyph, #000 at 0.45 (was solid #811d22) |
| Style 2 / Style 1 `movesPanel` | `style2/moves_panel.webp` / `hud/style1_moves_panel.webp` 280² | `btn_blue` 28:48177 / `notification_back` 28:48249 resized to 280 (their STRETCH rects keep radius 41) |
| Style 2 `settingsButtonBack` / `settingsButtonIcon` | `style2/button_settings.webp` 214² / `style2/icon_settings.webp` 158² | `btn_blue` 28:48120 / `icon_settings` 28:48121 (its clipped soft shadow included) |
| Style 1 `settingsButtonBack` / `settingsButtonIcon` | `hud/style1_settings_button.webp` 214² / `hud/style1_icon_settings.webp` 158² | `btn` 28:48212 (remote `btn/blue` 1:252 = local `btn_blue_dark` 28:49339) / `icon_settings_dark` 28:48213 |
| `noAdsPanel` (both styles) | `offer/promo_panel.webp` 112 × 118, caps 52 / 52 / 52 / 58, pad 6 | `Rectangle 66112` 28:48043 = 28:48067 (byte-identical): #3b1576, radius 41, a 6-unit 20 % ring |
| `noAdsDecor` (both styles) | `offer/noads_rays@0.5x.webp` 523² (1046 units) | `pic_decor_2` 28:48987 via 28:48058 = 28:48073 |
| Style 2 / Style 1 `noAdsArt` | `style2/noads_hero.webp` / `offer/style1_noads_hero.webp` 700² | `pic_no_ads_1` 28:45573 / `pic_pig_1` frame 28:48074 (the dark-outlined picture) |
| Style 1 `noAdsClose` | `offer/style1_noads_close.webp` 120² | `icon_close_dark` 28:48843 |

Reused, proved by pixel comparison of Figma renders against the committed files (mean |Δ| ≤ 1 / 255 unless noted):
Style 2 `icon_star_1` = `style2/icon_star.webp` (the WIN stars), `icon_coin_1` = `style2/icon_coin.webp` (the reward
coin, the No Ads price coin at 84), `btn_green` / `btn_yellow` = `style2/button_primary.webp` / `button_rewarded.webp`,
the light No Ads × = `style2/settings_close.webp`; Style 1 `pic_tape_red_dark` 28:49231 = `result/style1_ribbon_win@2x`
(0.68, the band one unit taller), `icon_coin_128` = `result/style1_reward_coin@2x`, `Btn_green_dark_2` /
`btn_orange_dark` + highlight = `button/button_green@2x` / `button_orange@2x` + `button_highlight@2x`, the No Ads
coin = `icons/icon_coin@2x`.

## Result WIN

- **Style 2** (new: Style 2 did not cover `result`, so a Style 2 game drew the donor Result): the red ribbon, the rays
  behind the content, the three stars (`resultStar` = `icon_star`, centres / sizes of `stars_full` 28:48380), REWARD,
  the coin with the amount (Calibri Bold 100, #943300 5-unit OUTSIDE stroke), CONTINUE on `btn_green` 354 × 214 and the
  secondary (Map / Levels / Retry — `retryLabel`) on the bare `btn_yellow` 458 × 214 (no highlight). Boxes = PC − 1544 with
  the ribbon / reward column / buttons + 5 (the mobile x): Figma's PC column sits at 535, Core centres it on 540.
- **Style 1**: the same art re-laid at theme_light_6's y, centred on 540 (Figma's PC composition is off-centre: the new
  1022-wide ribbon instance was dropped at the old band x — the ribbon on 612.5, the reward column on 508). The WIN glow
  is gone (`win.glow: null`), the × is the black 45 % glyph, the buttons are 440 × 200 / 460 × 200 with the highlight
  box (17.2, 4.67, 322.43, 167.29). The crown keeps its offsets from the ribbon top (no star in the dark WIN).
- **Not from Figma (adaptations)**: the light WIN has no × anywhere (95 nodes, none hidden) — Core draws the Style 2
  popups' red × (153 × 158) above the ribbon's right end; both light CTAs at their components' 214 (Figma: green 214, the
  yellow 200); the side stars upright (Figma tilts them 30°; the WIN star entrance lands every star upright); the
  `star_shine` halos (orange radial, blur 150) are not drawn — the entrance's own landing glow plays there; the
  green / yellow labels are single-line runtime CONTINUE / RETRY on the face (Figma shows REFILL NOW + price and the
  rewarded x2 offer).
- **Style 2 FAIL (derived, no Figma)**: theme_light_6 has no Result FAIL (`defeat_screen` 28:47869 is a NO STARS offer).
  A style covers both outcomes or neither, so Style 2's FAIL is composed from its own parts until the artist draws one:
  the same red ribbon with one title line, Confirm's broken heart (`icon_heart_2` at 338) over the blue blur with the
  runtime "-1", the outcome line, RETRY on Confirm's green button (528.7 × 214), EXIT on the yellow surface (460 × 214).
- WIN FX: the stars land on the style's rest boxes and the confetti centres on the WIN frame as before; the rays are
  decoration under everything (never measured, no input), the crown layers stay over the ribbon, the × on top.

## Moves (MovesView, generic)

Box-local boxes of the 280 box: "MOVES" at (40, 47, 200 × 60), the count at (40, 116.69, 200 × 140) light /
(40, 108, 200 × 140) dark. Light: Calibri Bold 50 / 150 white, plain. Dark: Fira Sans Black 60 white / 120 #ffc300 with
the kit's black 4-unit outline and 4-unit hard shadow. Placement is the host's gameplay composition (Figma: PC
1207, 1934 light / 1261, 1926 dark — off the 1080 frame). The hidden `btn_grey` 274 in every MOVES group (a possible
zero / disabled state) is not specified and not drawn.

**Footprint variants (analysed only, not implemented):** `Group 1357` 28:48180, `Group 1365` 28:48189, `Group 1356`
28:48196 (light) and `Group 1358` 28:48277 (dark) sit below the gameplay screens: the same box with "MOVES" hidden and
2–4 rotated foot rasters (alternating feet, the far ones at opacity 0.1–0.4) walking around / over it — the footstep
trail replaces the word MOVES as an icon-like label. Three light concepts (outlined feet on the blue box; two big feet
on its top edge; solid blue feet on the white box with an orange #e55636 number) and one dark (cyan feet). They are
loose concepts, not states, on no approved screen; `Group 1359` 28:48272 is a pixel duplicate of the dark box. Nothing
in Figma specifies motion. Not implemented without the artist's confirmation.

## Settings button

theme_light_6 draws it on the gameplay and victory screens only: a 214 square at top 90 / right 90 (light: `btn_blue`
+ the centred `icon_settings`; dark: the blue `btn` + `icon_settings_dark` 10 units above the centre). Neither main menu
(28:48400 / 28:48486, every descendant incl. hidden) has a settings button. Core: the new skin view `settingsButton`
(roles `settingsButtonBack` / `settingsButtonIcon`) drawn by `SettingsButtonView` in the top-right safe corner; the map
HUD (`hud.gear`) is unchanged — Style 2 still has no map gear (as its main menu), Style 1 keeps its HUD gear. Figma
gives no mobile gameplay layout: the button's place on a phone is the host's gameplay composition (it can offset the
corner through `insets`). The UI gallery's demo puts it under its HUD row when the row reaches the corner — a demo
layout only, not a theme_light_6 rule and not Core behaviour.

## No Ads

Both rows draw the same purple promo window (a 9-slice over the 1000 × 1860 box) and rays; the light row has the
popups' red ×, the light hero and Calibri text; the dark row the round red ×, the dark-outlined hero and the kit's
outlined text. The title lines are Core's `wordNo` / `wordAds`, the description's first line wraps in the big box, its
second line is the note, the price row is the price + the style's coin (only for `coinPrice: true`: a store price is the
text alone). Adaptations: Style 2's title font PoetsenOne Regular is not a Core font → Carlito Bold with Figma's #ec3d40
20-unit outline; Style 1's line-1 vertical pink gradient → its middle #f55985; the titles' soft group shadow and the
light sparkles (`pic_spark_1`) are not drawn; Style 2's buy button uses window caps 48 / 96 / 48 / 96
(`'noAds:buttonPrimary'`, the same file) so the 200-high button keeps Figma's corners. Copy stays Core's catalog
(EN NO / ADS, RU БЕЗ / РЕКЛАМЫ; Figma's ОТКЛЮЧЕНИЕ / РЕКЛАМЫ is host copy via `wordNo` / `wordAds` / `description`).

## Shop — not synced (gap)

theme_light_6's Shop: the phone screens 28:46095 / 28:46120 (light) and 28:46015 (dark) are the SHOP **tab** of the
main-screen navigation — the nav visible and tappable with SHOP selected, an opaque background, no dim; the modal
contexts are 28:46072 (dark), 28:48323 (PC light, internally inconsistent) and 28:45814 (PC dark, legacy components).
Core's `ShopWindowView` is a full-screen modal whose backdrop covers the nav, `LevelMapScreen` pins HOME selected, and
the shop geometry is donor constants. The dark modal is the donor art already (header, ribbon, card, coin piles —
pixel-equal to `shop/*`; only the round × differs); a light modal skin needs a new `shop` window contract (≈ 10 roles,
the constants → layout data) and Figma has no light phone modal to read it from. Matching theme_light_6 needs an owner
decision first: a non-modal shop content view the host shows under `BottomNavView` with `selectedId: 'shop'`, or a
LevelMapScreen tab mode. Not built in this slice.
