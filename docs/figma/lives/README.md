# Figma → Core: Lives

The second Figma window, built on the confirm-exit pipeline. Source: file `CNcGCBj8IvUXrPd01FbChm`, screen
`85:8944` (`screen/lives`, 1080 × 2344 = the kit's design units). `figma.json` is the read (node ids, boxes, styles,
how the Figma group names map to the window); `svg/` are Figma's exports; `reference/` is Figma's render of
`modal/lives` used for parity.

## Use

The default `LivesWindowView` is unchanged (the donor Trail Arrow art, required pack only). The Figma window is
requested explicitly, together with its textures — nothing else ever loads them:

```ts
const textures = await loadReadyUiAssets({ baseUrl, include: LIVES_FIGMA_TEXTURES });
new LivesWindowView({ ui, motion, textures, variant: 'figma', title, nextLifeLabel, refillLabel, adLabel, adRewardLabel, fullLabel, onRefill, onWatchAd });
```

Same params (`lives`, `maxLives`, `timerText`, `refillPrice`, `adOffer`), `setTimer` and continuations as the donor.
The heart shows the lives count only, as the design does (the donor shows `n/max`).

## What is reused, what is new

| Element | Figma | Core |
|---|---|---|
| window shell, title slot, × | `ui/window/base` at 960 × 1059 — the confirm-exit shell | `windowBase` 9-slice, `windowClose` (reused) |
| REFILL surface | `ui/button/surface` green, 371 × 207 | `buttonGreen` 9-slice (reused) |
| ad surface | `ui/button/surface` orange, 507 × 207 + `Rectangle 65898` gold highlight | `buttonOrange` 9-slice (caps = green's, measured) + `buttonHighlight` sprite |
| inner panel | `section/next-life/Rectangle 65858`, flat #a2a0f4, radius 50, no @stretch | `panelInset` 9-slice (caps 58 = radius + gutter, measured) |
| heart | `Group 412/Group 377` (the confirm heart without the crack) | `livesHeart` |
| icons | `icon_coin_128`, `icon_heart_128`, `Group 385` (a flattened `icon/reward`) | `iconCoin`, `iconHeart`, `iconAd` |
| texts | title 80, count 150, NEXT HEART IN 50, 24:15 70, REFILL NOW! 50, 900 64, GET 60, +1 60 | runtime (`placeFigmaLabel`) |
| price row | `Frame 381`: text + 1 + coin, hugging, centred on REFILL | laid out from the runtime text's advance |
| dim | `overlay/dim` #080b0d at 0.8 | backdrop |

The count is centred on its Figma box (the "1" there is left-aligned and hugging: the same place for "1", and it
stays centred for other counts).

## Parity (1080 × 2344 @1x vs Figma's render, `npm run showcase:lives`)

In place (best shift 0,0), mean |Δ| 0..255: header seam 0, × 0.11, panel corner 0.02, heart 0.74, green / orange
surfaces 2.1 / 1.6, highlight 0.51, clapper 1.8, heart icon 1.0. Letter labels: NEXT HEART IN, REFILL NOW!, GET within
½ px.

Digit runs (the count, 24:15, 900 + coin, +1) are reported, not enforced: Figma draws Fira Sans digits **tabular**
(every digit 0.5625 em — "900" at 64 = 108, "1" at 150 = 84.4, the footed "1"), the kit's `FiraSans-Black.woff2`
**proportional** ("900" = 114.3, "1" = 72.3). The slots are right (tests/pixi/windows.test.ts pins them); the glyphs
and run widths differ, so a centred digit run and the coin after the price sit 1–3 units off Figma. That is the font
slice (tabular figures as default), not layout offsets.
