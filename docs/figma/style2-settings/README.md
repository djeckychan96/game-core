# Figma → Core: Style 2 Settings

Source: file `5FWFwdO4QGeDfeQtloLNOS`, section `8:17492` `theme_light_3`, screen `8:17493` `настройки` (1080 × 2344);
leaf components from `8:17503` «компоненты для художников». Read 2026-10-01. Only `8:17493` and its child nodes
(`8:17495` popup, `8:17496` version, `8:17497` Sound ON, `8:17498` Music OFF, `8:17499` / `8:17500` labels, `8:17501`
Restart level, `8:17502` Return home) are a source for the composition; older Style 2 Settings, `theme_light_2` and
Style 1 are not.

- `figma.json` — the read: node ids, boxes, fills, text styles, what each became in Core, the asset pipeline spec;
- `render/` — Figma's own transparent renders (`get_screenshot`, `contentsOnly`) of the screen's top-level instances;
- `png/` — the `figma-assets` inputs: the icon / slash components' own renders (same size as on the screen, no
  overrides) and the surfaces `separate.mjs` took out of `render/`;
- `reference/screen-8-17493@0.5x.webp` — Figma's render of the whole screen (1x PNG sha256 `b6ea8e4d7b227e72…`),
  downscaled, lossy, for the parity check.

## Use

```ts
import { READY_UI_STYLE_2, SettingsWindowView, loadReadyUiAssets } from 'game-core/pixi';

const textures = await loadReadyUiAssets({ baseUrl, skin: READY_UI_STYLE_2 }); // + fonts/Carlito-Bold.woff, once
const settings = new SettingsWindowView({
  ui, motion, textures, i18n, theme: { skin: READY_UI_STYLE_2 }, id: 'settings',
  onToggle: (setting, enabled) => audio.set(setting, enabled), // the state stays the host's
  onHome: () => goHome(), onRestart: () => restartLevel()
});
settings.show({ sound, music, version: `VERSION ${build}`, gameButtons: inLevel });
```

No skin → the donor window, unchanged; Style 1 is unchanged. Style 2 has no haptic toggle: `haptic: true` with it
throws (the option stays in the generic API; donor and Style 1 still draw it).

## Rasters

The surfaces (`btn_blue` / `btn_grey` 228, `btn_green` / `btn_red` 822 × 200, `popup_back` + `header_back`, the ×)
are resized instances of 214 / 216 / 186 / 166 / 102 components: their exact pixels exist only inside the screen's
top-level instances, which carry an icon / text / slash too, and the MCP renders no `I…` sub-layer alone. Chrome's
raster of the SVG export is not usable here (the icons' drop shadow comes out far darker, the spread ring of every
button differs). So `separate.mjs` takes them from `render/`:

- pixels nothing covers stay Figma's;
- under a known cover (an icon / slash component render) the surface is unmixed (straight-alpha source-over inverted);
- under an opaque cover or the text it takes its row's value from uncovered columns (the surfaces are vertical
  gradients / flat fills; a row is constant away from the rounded edges);
- the popup's top-right corner under the × is its mirror (the popup is symmetric); the × is what lies over that
  panel: its own uncovered half mirrored, else red · t + black shadow solved per pixel.

Validation it prints: blue ⊕ `icon_sound` vs `8:17497` mean |Δ| 0.05 (max 12); grey ⊕ `icon_music` ⊕ `red_line` vs
`8:17498` mean 0.06 (max 8); the action-button rows from the left / right columns agree within 1, the header rows
within 2; × over the panel vs `8:17495` mean 0.03 (max 31).

```sh
node docs/figma/style2-settings/separate.mjs                       # render/ → png/ (surfaces)
node scripts/figma-assets.mjs docs/figma/style2-settings           # png/ → assets/pixi-ui/style2/settings_*.webp
node scripts/figma-assets.mjs docs/figma/style2-settings --check    # re-renders, compares with the committed files
```

| Core role | file | from |
|---|---|---|
| `settingsPanel` (9-slice 191 / 167 / 191 / 88, pad top 49) | `settings_panel.webp` 390 × 263 | `popup` 8:17495 without title / ×: `popup_back` + `header_back`; tolerance 4 (Figma dithers column 991 by 4 every 256 rows) |
| `settingsClose` | `settings_close.webp` 153 × 158 | `btn_close` I8:17495;8:17568 (render box) |
| `settingsSound` / `settingsMusic` | 228² | `btn_blue` (from 8:17497) + `icon_sound` 8:17512 / `icon_music` 8:17519 at 18, 15 |
| `settingsSoundOff` / `settingsMusicOff` | 228² | `btn_grey` (from 8:17498) + the same icons, no slash |
| `settingsOff` | `settings_off.webp` 190² | `red_line` 8:17554 |
| `settingsBtnRestart` / `settingsBtnHome` | 822 × 200 | `Btn_green` I8:17501;8:17557 / `Btn_red` I8:17502;8:17557 |
| `settingsIconRestart` / `settingsIconHome` | 158² / 166 × 158 | `icon_return` 8:17504 / `icon_home` 8:17536 |

Existing Style 2 art was checked first: nothing is pixel-equivalent (`play.webp` is the 550 × 280 PLAY `btn_green`,
`nav_selected.webp` is `blue_active`, `icon_home.webp` is the coloured 288 nav icon). Carlito is the LevelMap slice's.

## Geometry (window-local: the popup box is 40, 647 of the frame)

| part | Figma | Core (`windows.settings.gameplay`) |
|---|---|---|
| window | popup 1000 × 1050; header 756 × 166 at 122, −49 | `window` 1000 × 1050; the panel texture's pad top 49 |
| title | 166, −18, 668 × 110, Calibri Bold 90, white | runtime text (`core.settings.title`) |
| × | render 887, −37, 153 × 158 | `close` |
| toggles | 228² at 237, 220 / 534, 220; labels 227 × 73 at y 147, 60, `#3f598c`; slash 190 at 18, 15 | `sound` / `music`; `haptic: null`; `offButtons` |
| actions | 822 × 200 at 89, 482 / 89, 716; `btn_main` pad 50, gap 10, hug: icon 158 + text 70 white | `restart` / `home` with icons and `hug` (max text 554) |
| version | 89, 939, 822 × 61, 50, `#3f598c` | runtime text (the host's string) |
| dim | `#080b0d` @ 0.8 | `backdrop` |

`frame` is 1080 × 2344 (this screen): only windows read it — the HUD, map, nav and PLAY lay out against the theme's
design box, so the LevelMap screen is unchanged.

## Implementation adaptations (not from Figma)

- **Map variant** (`gameButtons: false`): not drawn in Figma. Core uses the same window without the two action rows:
  the version moves into Restart's place (482) and the window is 457 units shorter (593).
- **Runtime copy**: the existing keys (`core.settings.title / sound / music / restart / exit`) — EN `SETTINGS`,
  `SOUND`, `MUSIC`, `RESTART`, `EXIT`; RU `НАСТРОЙКИ`, `ЗВУК`, `МУЗЫКА`, `ЗАНОВО`, `ВЫХОД`. Figma's mixed sample copy
  (`НАСТРОЙКИ`, `Sound`, `Restart level`, `Return home`) is not a locale; `?figma=1` passes it as explicit host text.
- **Hug**: the icon + label row keeps Figma's centring for any text width; text wider than 554 units shrinks.
