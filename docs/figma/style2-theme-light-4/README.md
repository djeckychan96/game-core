# Figma → Core: Style 2 in theme_light_4

Source: file `5FWFwdO4QGeDfeQtloLNOS`, section `22:26884` `theme_light_4`, the light row of «Окна на переделку»
(`22:27249`, y 2583); leaf components in `22:26895` «компоненты для художников light_theme». Read 2026-10-05; the
snapshot is frozen for this pass. Style mapping: the light row is drawn with the light_theme components (`popup`,
`header_back`, `btn_green`, `btn_yellow`, `icon_heart_1/2`, Calibri Bold); the purple row under it is Style 1
(docs/figma/style1-theme-light-4).

| Figma | Core (`src/pixi/skins/style2.ts`) | change |
|---|---|---|
| `popart_restart` 22:28984 / `popart_leave` 22:29021 | `windows.confirm` | the Style 2 popup now (theme_light_3 drew the Style 1 window): 960 × 980, blur, `icon_heart_2` + runtime "-1", #3f598c body, `btn_green` 528.7 × 214 |
| `screen_refill_hearts` 22:28924 | `windows.lives` | popup 1050 → 756, buttons at its bottom, the tv / heart "+1" on the rewarded button's corners |
| its `offer` 22:28956, `popart_restart` `offer` 22:28986 | `windows.offer` + `offerPanel` / `offerBadge` / `offerLivesArt` / `offerCoinArt` | new: the orange OFFER 100 under the window, 14 right of it; no × (hidden in Figma) |
| `настройки` 22:28904 / 22:28915 | `windows.settings` | unchanged boxes; the new Language row is not drawn (SettingsWindowView has no language control) |
| `screen_victory` 22:29110, `defeat_screen` 22:29036 | — | Result stays uncovered: 22:29036 is a NO STARS continue offer (star hero, sample REFILL NOW / x2 buttons), not a Result FAIL, and a style covers both outcomes or neither |

Adaptations (not from Figma): a window alone is centred (Figma draws Exit 36 above the centre and the window + OFFER
compositions 30–40 off it); the GET slot is the free run between the tv and the heart (619–841, Figma's centre 730);
the reward "1" box is 100 wide around its centre so the runtime "+1" fits. The bubble under the OFFER (`bubble_1`,
«Продолжить с +3★») and the boosters are game content.

## Files

Reused (proved by pixel comparison of the raw image fills, mean |Δ| ≤ 0.6): `style2/icon_coin.webp` = `icon_coin_1`
(the OFFER coin hero and its price coin), `style2/icon_heart.webp` = `icon_heart_1`, `style2/icon_tv.webp`; the popup,
close, buttons and blur are the existing Settings / Refill files. New, from `png/` (Figma's `get_screenshot`
`contentsOnly` renders and raw image fills) and `svg/`:

```sh
node scripts/figma-assets.mjs docs/figma/style2-theme-light-4           # → style2/{offer_panel, confirm_heart, offer_lives, offer_badge@2x}
node scripts/figma-assets.mjs docs/figma/style2-theme-light-4 --check
```

Visual check: `examples/pixi-showcase/ui-gallery.html?style=2&screen=lives-full` (and `restart-offer`, `exit`,
`lives-minimal`, `settings-level`).
