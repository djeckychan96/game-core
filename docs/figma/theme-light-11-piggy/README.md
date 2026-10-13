# Figma → Core: theme_light_11 Piggy Bank (window, tutorial, the main screen's entry)

Source: file `5FWFwdO4QGeDfeQtloLNOS`, section `67:27577` `theme_light_11` — the LIGHT row is Style 2, the DARK row
Style 1. Read 2026-10-13 with read-only `use_figma` dumps and `get_screenshot` (`contentsOnly`) renders. Layers inside
an instance (the bubble without its text, the dark bar's trough / fill / frame / ticks one by one, Style 1's title
without its sparkles) and resized instances (`btn_grey` at 530 × 200, the 220 × 100 pills) were rendered from a
throw-away frame of detached clones, removed right after. Every number in the layouts names its node.

| Core | Style 2 (light) | Style 1 (dark) |
|---|---|---|
| `PiggyBankWindowView` — the bank | `screen_pig_bank` 67:30376 | `screen_pig_bank` 67:30801 |
| `PiggyBankWindowView` — the tutorial | `screen_pig_bank_learning` 67:30416 | `screen_pig_bank_learning` 67:30442 |
| feature-column entry (`iconPiggyBank` + `featurePill`, host art) | `icon_pig_bank_preview` 67:31249 (`icons` 67:31248) | `icon_pig_bank_dark_preview` 67:31366 |

```sh
node scripts/figma-assets.mjs docs/figma/theme-light-11-piggy          # writes the files below
node scripts/figma-assets.mjs docs/figma/theme-light-11-piggy --check  # re-renders, compares with the committed files
```

## Files (1 px / unit, no text inside)

| role | Style 2 | Style 1 |
|---|---|---|
| `piggyPanel` (9-slice) | `piggy/panel.webp` ← `Rectangle 66112` 67:30378 (#1f2975, r 41, the No Ads promo panel's shape) | the same file (`bg_pig_bank` 67:30803 has the same fills) |
| `piggyClose` | the popups' red × (`style2/settings_close.webp`) | `piggy/style1_close.webp` ← `icon_close_dark_2` 67:30813 (grey; the kit's Style 1 × is violet) |
| `piggyInfo` | `style2/piggy_info.webp` ← Group 1365 67:30385 | `piggy/style1_info.webp` ← 67:30804 |
| `piggyDecor` / `piggyStars` | No Ads' rays and star atlas (`pic_decor_2`, the same component: the stars match `NO_ADS_DECOR_BURST` within 0.4) | the same |
| `piggyArt` | `style2/piggy_pig.webp` ← `pic_pig_1` 67:30381 (856; the opaque rows 86..769) | `piggy/style1_pig.webp` ← `pic_pig_1_dark` 67:30810 |
| `piggySpark` | `style2/spark.webp` (`pic_spark_1`, featureSpark's file) | `piggy/spark.webp` ← `pic_spark_1` 67:27874 (the dark row uses it too; its own file so Style 1 loads no `style2/` file) |
| `piggyTitle` (RU only) | `style2/piggy_title_ru.webp` ← `title_pig_bank` 67:30411 (PoetsenOne, no Cyrillic outside Figma) | `piggy/style1_title_ru.webp` ← 67:30825 without its sparkles |
| `piggyBubble` | `style2/piggy_bubble.webp` ← `bubble_1` 67:30383 (its shadow 16 out) | `piggy/style1_bubble.webp` ← `bubble_2_dark` 67:30812 |
| `priceIcon` (bubble, BUY) | `style2/icon_coin.webp` (`piggyBank:` own) | the kit's `icons/icon_coin@2x` (= `icon_coin_128`) |
| `piggyBarBack` | `style2/piggy_bar_back.webp` ← the gold ring of `bar_orange_1` 67:30393 | `piggy/style1_bar_back.webp` ← `header_back` of `progress_bar_2_dark` 67:30817 |
| `piggyBarFill` (9-slice, x) | `style2/piggy_bar_fill.webp` ← `bar_orange_2` 67:30394 (822 × 122, r 30) | `piggy/style1_bar_fill.webp` ← its `Intersect` (820 × 89) |
| `piggyBarFrame` | — | `piggy/style1_bar_frame.webp` ← Group 1363 of `progress_bar_1_dark` 67:30818 (over the fill) |
| `piggyBarMarker` | `style2/piggy_bar_marker.webp` ← `bar_orange_3` + `bar_orange_4` | `piggy/style1_bar_marker.webp` ← Group 1362 |
| `piggyCoin` (the bar, the counters) | `style2/icon_coin.webp` (`icon_coin_1` 67:27705 is the same art) | `piggy/style1_coin.webp` ← `icon_coin_1_dark` 67:31833 |
| `buttonPrimary` / `piggyButtonOff` | `btn_green` at 530 × 200 (No Ads' caps) / `style2/piggy_button_grey.webp` ← `btn_grey` 67:27666 at 530 × 200 | the kit's green / `piggy/style1_button_grey.webp` ← `btn_grey_dark` 67:30823 |
| `piggyHand` / `piggyCoins` / `piggyArrow` | `style2/piggy_hand.webp`, `style2/piggy_coins.webp`, `style2/piggy_arrow.webp` (67:30423 / 30434 / 30437) | `piggy/style1_*` (67:30468 / 30478 / 30481) |
| `piggyTutorialArt` | — (the window pig at 919) | `piggy/style1_tutorial_pig.webp` ← 67:30470 (the instance carries its pink glow) |
| `iconPiggyBank` / `featurePill` | `style2/icon_piggy.webp` ← `icon_pig_bank` 67:27988; `style2/feature_pill.webp` ← `btn_green` at 220 × 100 | `level/style1_icon_piggy.webp` ← 67:32200; `level/style1_feature_pill.webp` ← `btn_green_dark` at 220 × 100 |

## Composition (window-local: x / y from the window's top-left; the window is 1000 × 1860 at 40, 202 of the frame)

- The bank: the rays (No Ads' burst, turning) behind the pig, the title (RU picture / runtime lines), the sparkles,
  the bubble with the balance, the bar (back, the fill resized to balance / capacity, Style 1's frame, the tick on the
  purchase threshold with its counter over it, the capacity counter at the end, the coin at the start), two lines of
  state copy (the first one's `[marked]` part in #f9c32a / #ffe100), BUY (label over the price row).
- The tutorial: Style 2's `pics` frame clips (0, 40, 1000 × 1455) — the still rays (the instance is resized to
  1041.86 × 913: `scaledDecorBurst`) and the pig run into its bottom edge; Style 1's does not clip. Its 8 sparkles are
  `pic_spark_1` squeezed like the instances. The rule's number is the level's threshold (Figma's sample: 1500).
- Not drawn as in Figma: the sample values (9500 / 900, 2500 / 3500, 1500); Style 1's greyed РАЗБИТЬ button 12.5 left of
  centre — Core centres it and draws the label over the price like the light row.
