# Figma → Core: theme_light_11 (Daily Quests window, the daily-quests entry icon)

Source: file `5FWFwdO4QGeDfeQtloLNOS`, section `67:27577` `theme_light_11` — the LIGHT row is Style 2, the DARK row
Style 1. Read 2026-10-13 with read-only `use_figma` dumps (`exportAsync` SVG of the row's leaf layers) and
`get_screenshot` (`contentsOnly`) renders; every number below names its node.

| Core | Style 2 (light) | Style 1 (dark) |
|---|---|---|
| `DailyQuestsWindowView` — list | `screen_daily_quests` 67:30483 | `screen_daily_quests` 67:30755 |
| `DailyQuestsWindowView` — all claimed | `screen_daily_quests` 67:30498 | `screen_daily_quests_complete` 67:30769 |
| feature-column entry (`iconQuests`, host art) | `icon_tasks` 67:27943 (`screen_main_menu_pc` 67:31148 → `icons` 67:31248) | `icon_tasks` 67:31369 (`screen_main_menu_pc_dark` 67:31282) |

```sh
node scripts/figma-assets.mjs docs/figma/theme-light-11          # writes the files below
node scripts/figma-assets.mjs docs/figma/theme-light-11 --check  # re-renders, compares with the committed files
```

## Files (1 px / unit, no text inside)

| role | Style 2 | Style 1 |
|---|---|---|
| `windowSurface` / `windowClose` | the Settings popup (`popup` 67:27644 = popup_back + header_back) and its red × — existing files | the window shell (`popup_dark` 67:31430: #c3c1ff body, 175 #7453d5 header) and its × — existing files |
| `questSlot` (9-slice: rows 900 × 250, the timer panel 900 × 300) | `style2/quest_slot.webp` ← `daily_tasks_1` I67:30487;67:27883 | `quests/style1_slot.webp` ← `daily_tasks_1_dark` I67:30759;67:31877 |
| `questBarEmpty` / `questBarFull` (horizontal 9-slices; the fill is RESIZED to the progress share, as `progress=daily_bar_half` 67:28016 does) | `style2/quest_bar_empty.webp` / `quest_bar_full.webp` (462 × 84 renders) | `quests/style1_bar_empty.webp` (456: the stroke bleeds 3) / `style1_bar_full.webp` (450 × 50) |
| `questButton` (the row's 230 × 130 `btn_green`) | `style2/quest_button.webp` | `quests/style1_button.webp` (`btn_green_dark`) |
| `questCup` (rows at 170, the all-claimed screen at 510) | `style2/quest_cup.webp` ← 67:30503 | `quests/style1_cup.webp` ← 67:30776 |
| `questTimer` | `style2/quest_timer.webp` ← 67:30520 | `quests/style1_timer.webp` ← 67:30794 |
| `questGlow` | the Lives glow `frame_blur_bg` (`style2/lives_glow@0.5x.webp`), drawn × 1.125 — 67:30502 is the same component scaled | `quests/style1_glow@0.5x.webp` ← `frame_blur_bg_dark_2` 67:30774 (render box 1080 × 1003.4) |
| `questRays` | — (none in Style 2) | `quests/style1_rays@0.5x.webp` ← `rays_1_dark` 67:30775 |
| `questSpark` | `style2/spark.webp` (`pic_spark_1`; the bare `spark_1` vectors are its 137-wide star) | `level/style1_spark.webp` (`pic_spark_2`, 42) |
| `rewardCoin` | `style2/icon_coin.webp` (`icon_coin_1` 67:27705 is the same art: mean \|Δ\| 0.66) | Result's `icon_coin_128` |
| `iconQuests` | `style2/icon_quests.webp` | `level/style1_icon_quests.webp` |

## Composition (window-local: x from the popup's left, y from its top)

- Popup at 40, 244 (Style 2) / 60, 200 (Style 1) of the 1080 × 2344 frame; its title box and × are the Settings window's.
  Figma's popup runs on past the frame (2340 high); Core ends the window under its last row and scrolls the rows under
  the title tape when they do not fit the screen.
- Rows (`Frame 1249`): Style 2 at 50, 140, gap 15; Style 1 at 30, 205, gap 30. Row: the cup, the text (`mid`: Figma has
  ONE two-line task text — Core draws the quest's name over its task in that box), the bar with `progress / target`, the
  reward (amount + coin) over the button, GO or Claim reward on the button.
- All claimed: glow (+ rays), cup 510, the stars, the title (Style 2 Calibri Bold 120 #1a97fe; Style 1 Fira Sans Black 100
  white with the kit stroke and shadow), the note, the timer panel with `icon_timer`, "New quests in:" and the countdown.
- Not drawn: Figma's sample values (900 coins, 0/30, the purchase text) — every number and text is runtime; Style 1's
  "0/30" is Fira Sans Bold in Figma (the kit ships Black only).
