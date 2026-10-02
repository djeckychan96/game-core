# Style 1 Result WIN / FAIL

Canonical file: `sJ0BV1ARqMpcj5dZbjFppz` (section `1:910` 02 / SCREENS / 1080x2344).

- WIN: `screen/result-win` `1:3854`, `modal/result-win` `1:3953`
- FAIL: `screen/result-fail` `1:4029`, `modal/result-fail` `1:4128`
- ribbon: `ui/ribbon/title` red `1:4024`, grey `1:4141` (layers `77:3137` back, `77:3101` / `77:3119` tails, `77:3073` front)
- glow: `Rectangle 218` `1:3955` (WIN `#933ace`) / `1:4130` (FAIL `#445a66`), layer blur 225.7
- close: `action/close` `1:4025` (`#811d22`) / `1:4142` (`#445a66`)
- reward coin: `icon_coin_128` `1:3958`; broken heart: `Group 170` + `Vector 28` (`1:4132`, `1:4139`)

`figma.json` holds every box (frame units = design units) and the asset recipes. Generate or verify the textures:

```sh
node scripts/figma-assets.mjs docs/figma/style1-result
node scripts/figma-assets.mjs docs/figma/style1-result --check
```

Notes:

- The ribbon textures are the four SVG layers of the instance (no text: the title / subtitle are runtime). Their render
  box is 1019 × 239 — Figma's own render of the instance has the same size. The SVG export of the back band carries a
  red (`#DB2326`) inner shadow that Figma's render does not show (`reference/ribbon-*-render@1x.png`: `#261a30` there);
  the SVG colour matrix was set to `#261a30` so the texture matches the render (mean |Δ| 0.35 / 255, max on AA edges).
- The glow SVGs are written in Figma's export form (`stdDeviation` = radius / 2, render box = box + radius) because the
  screen frame clips Figma's own render at x 0..1080 (`reference/glow-*-frame-clipped@0.56x.webp`); against that render
  the texture is within mean 6.9 / 255, max 22 (Chrome vs Figma blur).
- The reward coin is its own export (the donor `coin_big` differs: mean 8.4, max 159). The broken heart is Confirm's
  `lifeLostArt`; CONTINUE / TRY AGAIN are `buttonPrimary`, the WIN secondary `buttonRewarded` + `buttonHighlight`
  (Lives' files).
- Not Style 1: the hero art above the ribbon (`art/result-win-hero` trophy, `art/result-fail-hero` — the game's bear
  character) is game content; the WIN star crown keeps that place. A future per-game asset override.
- No Figma node: Core's WIN secondary is RETRY (Figma shows a rewarded x2 offer: clapper, price, badge — not drawn), and
  Core's optional FAIL EXIT is drawn with the RETURN HOME art (`settings/btn_home.webp`) at 0.85 under TRY AGAIN.
