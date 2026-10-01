# Figma → Core: Style 2 Confirm (Restart / Exit)

Source: file `5FWFwdO4QGeDfeQtloLNOS`, section `8:17492` `theme_light_3`, screens `8:22049` `попап рестарт` and
`8:22069` `попап выйти` (1080 × 2344). Read 2026-10-02. **Provisional approved snapshot**: the artist is still working
on Style 2; this is what the current implementation follows, not a frozen style.

- `figma.json` — the read: node ids of both screens, boxes, fills, text styles, main component keys, what each became
  in Core, the equivalence proof, the sample values that are NOT baked;
- `reference/screen-8-22049@0.5x.webp`, `reference/screen-8-22069@0.5x.webp` — Figma's renders of the screens,
  downscaled, lossy, for the parity check.

No `png/` and no asset of its own: the two screens are the **Style 1 window**. `Component 9` is an instance of the remote
library component `Component 8` (key `74018e09…`), the button of `Btn_base` (key `c26df14d…`); the modal groups' own
renders match Style 1's `docs/figma/confirm-exit/reference/modal-820-77658@1x.png` (Exit: mean |Δ| 0.0, max 12;
Restart: the same outside its button label). Restart and Exit differ only in the button's copy.

## Use

```ts
import { ConfirmWindowView, READY_UI_STYLE_2, loadReadyUiAssets } from 'game-core/pixi';

const textures = await loadReadyUiAssets({ baseUrl, skin: READY_UI_STYLE_2 }); // once, for every Style 2 view
const restart = new ConfirmWindowView({
  ui, motion, textures, i18n, theme: { skin: READY_UI_STYLE_2 }, id: 'confirm-restart',
  action: 'restart',                      // RESTART / ЗАНОВО (core.confirm.restart)
  onConfirm: () => restartLevel()         // the host's action (spend the life, restart)
});
const exit = new ConfirmWindowView({ /* same */ id: 'confirm-exit', action: 'exit', onConfirm: () => leaveToMap() });
```

One view, one layout: `action` only picks the button's default copy; `onConfirm` (after the close), `onDismiss` (× /
backdrop) and every text option are unchanged. No skin → the donor window; Style 1 → unchanged.

## Core mapping

| Figma | Core (`READY_UI_STYLE_2`) |
|---|---|
| `Component 9` shell, × | `'confirm:windowSurface'`, `'confirm:windowClose'` = `READY_UI_STYLE_1.assets.windowSurface / windowClose` |
| `Btn_base` green surface | `'confirm:buttonPrimary'` = Style 1's `buttonPrimary` |
| `Rectangle 218` glow, broken heart | `heroGlow`, `lifeLostArt` = Style 1's |
| geometry | `windows.confirm`: Style 1's numbers (window-local, the window box at 60, 675) |
| Fira Sans Black + 4 / 4 stroke / shadow | `windows.confirm.text` (the kit font, not Carlito) |
| dim `#080b0d` @ 0.8 | `backdrop` |
| sample copy / `-1` | runtime: `core.confirm.title`, `core.confirm.lose_life`, `core.confirm.restart` / `core.confirm.exit`, `lifeDelta` |

The window-scoped keys (`'confirm:<role>'`) exist because Style 2's Lives / Settings popup draws `windowSurface`,
`windowClose` and `buttonPrimary` with the white / blue art: one style, two window shells.

## When the artist changes it

1. `get_metadata` / a read-only dump of `8:22049` and `8:22069`: compare boxes, fills, text styles and the main component
   keys with `figma.json`.
2. Re-render both screens (`get_screenshot`) and diff with `reference/` (`npm run showcase:style2-windows` prints the
   region parity against them).
3. If the window moved to the Style 2 popup look: drop the `confirm:*` keys and `windows.confirm.text`, give Confirm
   the popup roles (or new leaves exported like `docs/figma/style2-refill-hearts`) and update `windows.confirm`.
