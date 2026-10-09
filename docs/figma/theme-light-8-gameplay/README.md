# Figma → Core: theme_light_8 gameplay row art (booster back, level emblem, locked slot)

Source: file `5FWFwdO4QGeDfeQtloLNOS`, section `46:35261` `theme_light_8` — gameplay `screen_gameplay_pc` 46:38123
(light = Style 2) and `screen_gameplay_pc_dark` 46:38230 (dark = Style 1), the export sets `ЭКПОРТ_light_theme`
46:35624 / `ЭКПОРТ_dark_theme` 46:35724. Read 2026-10-09 with one read-only `use_figma` dump, `get_metadata` and
`get_screenshot` (`contentsOnly`) renders.

Art only: the roles are the gameplay row's pieces a host composes around the MOVES box (Core has no view for them and
draws none of them; MovesView still needs `movesPanel` alone). They are optional `moves` roles, loaded with the style
(`loadReadyUiAssets({ skin })`) under `textures.skins[skin.id][role]`. Texts ("34", "Lvl 7", the sample "3"), earned
stars and positions stay the host's.

## Roles

| role | Style 2 (light) | Style 1 (dark) |
|---|---|---|
| `boosterBack` | `style2/booster_back.webp` 300² — **new**: `popup_back` 46:38152 (component 46:35357 = export-set 46:35631, 186, resized to 300: the white face and orange rim keep their 7 / 34 insets, so it is the 300 render, not a scaled 186) | `hud/style1_moves_panel.webp` 280² — reused: `notification_back` 46:38262 / 46:38257 at 280 = the MOVES box render (mean \|Δ\| 0, byte-identical pixels) |
| `levelEmblem` | `style2/level_node_open.webp` 384² — reused: `reward_stars_1` 46:35715 = the map's open node (mean \|Δ\| 0.53) | `level/style1_emblem.webp` 384² — **new**: `reward_emblem_2_dark` 46:35808 (the base with three empty star slots, no sample "3" / stars) |
| `lockedSlotBack` | `style2/locked_slot.webp` 266 × 265 — **new**: `btn_grey` 46:38173 of `btn_lvl` 46:38172 (component 46:35355, 214, resized), no text / lock | `hud/style1_locked_slot.webp` 266² — **new**: `btn_grey_dark` 46:38268 of `btn_lvl` 46:38267 (component 46:39090, 214, resized), no text / lock |
| `lockedSlotIcon` | `style2/nav_lock.webp` 288² — reused: `icon_lock` 46:35402 = the nav lock (mean \|Δ\| 0.8); Figma draws it at 150 | `nav/style1_icon_lock.webp` 288² — reused: `icon_lock_dark` 46:38841 = the same art drawn ~1.6 % larger in its 288 box (mean \|Δ\| 2.2); Figma draws it at 150 |

Mean \|Δ\| = per-channel premultiplied difference against Figma's transparent render (0–255).

New files: 4, 73 816 bytes in all (lossless WebP, 1 px / unit, render box = node box):

```sh
node scripts/figma-assets.mjs docs/figma/theme-light-8-gameplay          # writes the four files above
node scripts/figma-assets.mjs docs/figma/theme-light-8-gameplay --check  # re-renders, compares with the committed files
```

## Not covered

- The "Lvl 7" caption (Calibri Bold, the slot's runtime text) and the boosters' counts: host text.
- The dark emblem's earned stars are `icon_star_1_dark` (160 centre / 140 sides) in Figma; not exported here.
- theme_light_8 also shows a Style 2 MOVES box on `popup_back` (`Group 1363` 46:38155) next to the `btn_blue` one
  (`Group 1358`); Style 2 `movesPanel` is unchanged.
