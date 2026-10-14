# Figma → Core: `pig_anima` (the piggy-bank entry's animation)

Source: file `5FWFwdO4QGeDfeQtloLNOS`, frame `90:27944` `pig_anima` (400 × 400). Read 2026-10-14 with
`get_design_context` (layers, boxes, images) and `get_motion_context` (`recursive: true`): three animated layers in one
timeline cohort, 2000 ms, `loop`.

| layer (bottom → top) | node | box in the frame | tracks |
|---|---|---|---|
| `iconPiggyBankCoin` | `icon_coin_1` 90:27945 | 100 × 100 turned 20°, bounding box 128.171 at 174.91, 67.91 | translate |
| `iconPiggyBankPig` | `icon_pig_bank_2` 90:27946 | 250 × 250 centred at 190, 191 (= the static icon's box) | translate, scale |
| `iconPiggyBankSpark` | `pic_spark_1` 90:27947 | 100 × 100 at 225, 40 | rotate, translate, scale |

The keyframes are in `src/pixi/fx/piggyIconMotion.ts` (`PIGGY_ICON_MOTION`) exactly as Figma exports them: offsets,
values, the timing function of every segment (`ease-in`, `ease-out`, `cubic-bezier(…)`, none = linear), origin = each
layer's centre. `KeyframeMotionView` (`src/pixi/fx/KeyframeMotion.ts`) plays them on the host's MotionRuntime.

```sh
node scripts/figma-assets.mjs docs/figma/pig-anima          # writes the two files below
node scripts/figma-assets.mjs docs/figma/pig-anima --check  # re-renders, compares with the committed files
```

## Files (1 px / unit — the static icon's density)

| role | file | source |
|---|---|---|
| `iconPiggyBankPig` | `piggy/entry_pig.webp` 250 × 250 | the fill image of `icon_pig_bank 1` I90:27946;113:18200 (468 × 374, the pig WITHOUT its coin), at 3.99 % / 13.24 %, 92.01 % × 73.53 % of the box |
| `iconPiggyBankCoin` | `piggy/entry_coin.webp` 100 × 100 | the fill image of `icon_coin 1` I90:27945;1:1595 (500 × 500) over the box |
| `iconPiggyBankSpark` | Style 1 `piggy/spark.webp`, Style 2 `style2/spark.webp` (the same bytes) | `pic_spark_1` — the SVG of 90:27947 (`svg/spark-90-27947.svg`) rasterised at 190 has the same alpha box and mean as the committed 190 render of 67:27874, so the file is reused |

Both styles draw these layers: Figma has the animated layers only in the LIGHT art (the dark `icon_pig_bank_dark`
67:32200 is one flat picture with its coin). A dark set is a data change — point Style 1's three roles at new files.

## Porting the next animation the same way

1. `get_design_context` + `get_motion_context` (`recursive: true`) on the frame; download the layers' fill images.
2. A `figma.json` here: one texture per animated layer, its image placed in the layer's own box, `figma-assets.mjs`.
3. A `KeyframeMotion` constant: `durationMs` of the cohort, the frame, per layer its box / rotation and the CSS
   keyframes (translate px, scale, rotate rad, opacity; `animation-timing-function` of a keyframe → its `ease`).
4. A host: `new KeyframeMotionView({ motion, animation, textures })`, placed over its art; `play()` / `stop()` on its
   own condition, `setPaused()` while off screen.
