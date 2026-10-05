# Figma → Core: Style 1 in theme_light_4

Source: file `5FWFwdO4QGeDfeQtloLNOS`, section `22:26884` `theme_light_4`, the purple row of «Окна на переделку»
(`22:27249`, y 6052). Read 2026-10-05; the snapshot is frozen for this pass. Style mapping: the purple row draws Style 1's
own components (`Component 9` window shell, `Btn_base`, the Fira Sans Black kit text) — the same art Core already ships
for Style 1; the light row above it (y 2583) is Style 2.

| Figma | Core (`src/pixi/skins/style1.ts`) | change |
|---|---|---|
| `попап восполнить жизни` 22:27562 | `windows.lives` | window 1059 → 990, REFILL NOW / GET +1 71 higher; alone it is centred (y 677) |
| its `offer` 22:28069, `попап рестарт` 22:28101 `offer` 22:28122 | `windows.offer` + `offerPanel` / `offerBadge` / `offerLivesArt` / `offerCoinArt` | new: the OFFER panel under Lives / Confirm |
| `попап выйти` 22:28232 | `windows.confirm` | unchanged (same boxes) |
| `попап рестарт` 22:28101 top | `windows.confirm` (`action: 'restart'`) | unchanged window; the OFFER under it |
| `настройки гл экран` 22:28430 | `windows.settings` | toggle row 291 → 478 (labels 204 → 391), SETTINGS 100, version plain #716dd0, × = the shell's violet × |
| `победа` 22:28251 | `windows.result.win` | unchanged boxes; Figma's rewarded x2 button is still not Core's (RETRY stays) |
| `попап рестарт` 22:28152 (RESPAWN / GET 3 STARS) | — | rejected: a draft (placeholder «Нужна иконка сломанной звезды») |

Not Core's: the speech bubble under the OFFER (`bubble_2`, «Продолжить с +3★» — game copy about the game's stars) and
the booster icons (game content a host passes as `items`).

## Files

`svg/` holds Figma's SVG exports of the leaves; `figma.json` `assets` composes them (the badge = the two `Union` layers
of `icon_sale` 22:28091 turned −30° in `svg/offer-badge.svg`; the ∞ heart = Group 170 + Group 378):

```sh
node scripts/figma-assets.mjs docs/figma/style1-theme-light-4           # → window/style1_offer_badge@2x, icons/style1_offer_lives@2x, icons/style1_offer_coin@2x
node scripts/figma-assets.mjs docs/figma/style1-theme-light-4 --check
```

Visual check: `examples/pixi-showcase/ui-gallery.html?style=1&screen=lives-full` (and `restart-offer`, `settings-map`).
