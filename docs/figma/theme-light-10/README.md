# Figma → Core: theme_light_10 decor motion (No Ads, WIN)

Design source: team file Hazar_UI `GxeOt526TDg4ed59ApAlTd` (`theme_light` 1:1461). Assets are exported from the owner's
copy `5FWFwdO4QGeDfeQtloLNOS`, section `theme_light_10` 62:26750 (read 2026-10-12 with read-only `use_figma` dumps and
`get_screenshot` `contentsOnly` renders; the RU title through a throw-away clone of its group without the two sparkles,
removed right after the render).

```sh
node scripts/figma-assets.mjs docs/figma/theme-light-10          # writes the files below
node scripts/figma-assets.mjs docs/figma/theme-light-10 --check  # re-renders, compares with the committed files
```

| role | file | from |
|---|---|---|
| `noAdsDecor` (both styles) | `offer/noads_rays_only@0.5x.webp` 523² (1046 units) | `rayes` 62:30878 of `pic_decor_2` 62:30877 alone (radial gradient at 0.5, layer blur 22.87) — the stars are no longer baked in |
| `noAdsStars` (both styles) | `offer/noads_stars.webp` 731 × 118 | the 9 distinct STAR shapes of `stars` 62:30879 (fillGeometry SVGs in `svg/`, #496AFF); 17 stars placed by `NO_ADS_DECOR_BURST` (centre, Figma rotation, node opacity 0.3) |
| Style 2 `resultGlowWin` | `style2/result_rays_only@0.5x.webp` 915 × 885 (1830 × 1770 units) | `rayes` 62:27021 of `pic_decor_1` 62:27020 alone (blur 40) |
| Style 2 `resultStarsWin` | `style2/result_stars.webp` 427 × 117 | the 5 distinct STAR shapes of `stars` 62:27022 (#4B7FC7); 13 stars placed by `win.burst` (fill opacity 0.2 / 0.5) |
| Style 2 `noAdsTitle` | `style2/noads_title_ru.webp` 820 × 342 | `title_coin_keeper` 62:29924 without its `pic_spark_1`s: ОТКЛЮЧЕНИЕ / РЕКЛАМЫ PoetsenOne 120 / 90, white, #EC3D40 20 OUTSIDE, the group shadow 0 / 6 / 4 at 40 % |
| Style 2 `noAdsSpark` | `style2/spark.webp` (reused) | `pic_spark_1` 62:27038 = theme_light_9's 50:26242 |

Rotation centres = the 8-fold symmetry centres of the rays renders (No Ads 516, 513 of the 1045.75 box; WIN 904.5, 868
of the 1830 × 1770 box; within 2 units of the radial gradients' centres). The WIN box keeps theme_light_6's burst centre
(530, 1149 in the frame). The title sparkles: 1:4273 / 62:29927 (123.5 at 86, 337) and 1:4272 / 62:29928 (95 turned 45°
around 765.18, 600.18).

Why a picture for the title: PoetsenOne (Google Fonts) has no Cyrillic, so RU can only match Figma as Figma's own
render; the picture is drawn only for exactly its lines (`titleArt.lines`), any other copy (EN) stays runtime text.
