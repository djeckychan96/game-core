# Figma → Core: confirm-exit

The first Figma-exact Ready UI window. Source: file `CNcGCBj8IvUXrPd01FbChm`, screen `820:77655`
(`screen/confirm-exit`, 1080 × 2344 = the kit's design units). `figma.json` is the full read (node ids, boxes,
styles, the component @stretch/@content frames); `svg/` are Figma's own exports; `reference/` is Figma's render
of `modal/confirm-exit` used for parity.

## Use

The default `ConfirmWindowView` is unchanged (the donor Trail Arrow art, required pack only). The Figma window is
requested explicitly, together with its textures — nothing else ever loads them:

```ts
const textures = await loadReadyUiAssets({ baseUrl, include: CONFIRM_EXIT_FIGMA_TEXTURES });
new ConfirmWindowView({ ui, motion, textures, variant: 'figma', title, body, confirmLabel, lifeDelta, onConfirm, onDismiss });
```

A requested texture that is missing rejects `loadReadyUiAssets`, naming the file; `variant: 'figma'` without the
textures throws before anything registers.

## Geometry (design units, screen / window-local)

| node | Figma | Core |
|---|---|---|
| window `ui/window/base` | 60, 675, 960 × 994 (master 960 × 1198) | 9-slice `windowBase` + bleed 4 / 4 / 4 / 8 |
| title `slot/title` | 135, 34, 690 × 104 · Fira Sans Black 80 · centre | runtime text |
| × `action/close` | 863, 61, 50.52 (SVG box 51) | `windowClose`, hit 150 |
| glow `surface/message-card` | render 29.3, 5.3, 902 × 806 (blur 225.7) | `messageGlow` @0.5x |
| heart `art/broken-heart` | render 317, 264, 326 × 298 | `brokenHeart` @2x |
| "-1" `slot/life-delta` | 543, 345 · 150 · left | runtime text |
| body `slot/body` | 63, 586, 834 × 113 · 50 · centre | runtime text |
| button `ui/button/base` | 180, 725, 600 × 206 · label slot 25, 27, 550 × 128 · 80 | 9-slice `buttonGreen` + runtime label |
| dim `overlay/dim` | #080b0d at 0.8 | backdrop |

Text: white, 4 OUTSIDE round stroke, hard drop shadow 0 / 4, both black; AUTO line height (1.2 em). Layers bottom →
top as in Figma: shell, title, ×, glow, button, body, heart, "-1". On screen the window keeps its share of the
1080 × 2344 frame (contain fit, centred): 390 × 844 → scale 0.36007, 1280 × 800 → 0.34130.

## 9-slice caps (texture units)

`node scripts/figma-assets.mjs docs/figma/confirm-exit` rasterises the SVGs in Chrome, measures which rows /
columns are identical, and crops caps + an 8-unit centre; `--check` re-renders and compares with the committed
files. Caps = max(Figma @stretch + bleed, measured + 8-unit gutter):

| texture | Figma @stretch | measured | Core caps (L / T / R / B) |
|---|---|---|---|
| `windowBase` | 80 / 175 / 80 / 80 (+ bleed 4 / 4 / 4 / 8) | 84 / 179 / 84 / 102 | 92 / 187 / 92 / 110 |
| `buttonGreen` | 51 on every side (`ui/button/surface` style=green) | 59 / 61 / 59 / 81 | 67 / 69 / 67 / 89 |

- The window's bottom cap grows because the −23 inner shadow reaches 14 units into @stretch at the rounded edge.
- The button's @stretch (51) is short of its own corners: the rects start at x 8 / y 5.
- The gutter keeps identical texels on both sides of every seam; without it, filtering smeared the header's inner
  shadow down the stretched body (a band under the header in the first parity run).

## Parity (1080 × 2344 @1x vs Figma's render, `npm run showcase:confirm`)

Mean |Δ| per region (0..255) and where the Core content sits relative to Figma:

- shell header seam 0.81, × 0.26, button surface + label 0.99, heart 4.84 — all in place (0, 0);
- text: title −0.75 / −0.25 px, button label 0 / −0.25, "-1" −0.25 / +0.5, body +1.25 / 0.

The body's halves move apart (+1.25 / −1.5), so the run is centred correctly and only narrower. Cause: the kit font
(`fonts/FiraSans-Black.woff2`) draws "1" without the foot serif Figma's Fira Sans Black has. That is also why the "-1"
region differs (mean 27) while in place. This is a font-asset difference and out of scope here.
