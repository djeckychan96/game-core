# Style 1 HUD + LevelMap assets

Canonical file: `sJ0BV1ARqMpcj5dZbjFppz`.

- desktop LevelMap: `1:911`
- mobile LevelMap: `1:1301`
- gameplay references: `1:4597`, `1:5003`
- blue node component: `1:9`
- violet HARD node component: `1:3`
- lock group: `1:29`
- violet HARD surface: `1:17` (`1:18` + `1:19`, without the localized text layer)
- current glow: `1:1336`
- rail: `1:1346`

The SVG and PNG files in this directory are exact Figma exports.

The current glow (`1:1336`, Group 268) is not exported here. The MCP raster of that node is fully opaque (alpha 255
everywhere, the screen background baked into its 819 × 522 render bounds), which drew a hard rectangle around the
current level. Style 1 uses the donor pack's `level/shine.webp` instead: it is the transparent export of the same
render bounds at 0.6×. Composited over the background model of the opaque raster, it reproduces that raster with a
mean error of 1.4 / 255 (max 7.5, lossy WebP), against 52 / 255 for no glow. Runtime level numbers and localized `HARD` text are intentionally absent from the art. The HUD capsule, heart, coin, plus and gear exports are pixel-equivalent to the existing files under `assets/pixi-ui/hud/`, so Style 1 reuses those files by semantic role.

Generate or verify the lossless WebP textures:

```sh
node scripts/figma-assets.mjs docs/figma/style1-hud-level-map
node scripts/figma-assets.mjs docs/figma/style1-hud-level-map --check
```

There is no canonical completed-node asset in these Figma references. Core therefore retains its existing completion semantics and rating stars instead of inventing Style 1 completed art.
Their placement is Core's crown re-fitted to the node circle (Ellipse 4): the donor star slots' position and size
relative to the donor badge circle, so the stars sit on the top rim, clear of the number. The HARD surface covers that
rim, so on a HARD node the crown rests on the surface's top edge, in front of it (`starsOnHardBadge`). The red `VERY HARD` variant is not exported because the current public model supports only `hard: boolean`.
