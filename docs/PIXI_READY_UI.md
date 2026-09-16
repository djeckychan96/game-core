# Game Core · Pixi Ready UI

`game-core/pixi` is the ready-made, drawn UI layer of Game Core for PixiJS 8 hosts. A game plugs
in its data (levels, progress, coins, lives, callbacks) and gets a finished, animated interface:
level map, HUD, result / lives / shop / settings / no-ads / starter-pack windows. The art and the
geometry come from Trail Arrow 1:1 and now live physically inside this package
(`assets/pixi-ui/`); the behaviour runs on the renderer-agnostic foundation (`UiRuntime`,
`MotionRuntime`, `CoreRuntime`).

```
game-core
├── "game-core"        renderer-agnostic: CoreRuntime, FxRuntime, MotionRuntime, UiRuntime
└── "game-core/pixi"   Pixi Ready UI: LevelMapView, HudView, UiButton, ModalWindow,
                       ResultWindowView, LivesWindowView, ShopWindowView, SettingsWindowView,
                       NoAdsWindowView, StarterPackWindowView, assets loader, theme;
                       Pixi FX (src/pixi/fx): ClickRippleEffect
```

Rules that keep the two layers apart:

- `import "game-core"` never pulls PixiJS in. The kit is a separate build (`dist/pixi/`) with
  `pixi.js` as an **external optional peer dependency**; the post-build check
  (`scripts/check-pixi-build.mjs`) fails the build if either bundle drifts.
- The kit imports the foundation as **types only**: a host passes its own `UiRuntime` and
  `MotionRuntime` instances in, so there is exactly one clock, one cancellation tree and no
  duplicated core code.
- The kit never creates a ticker or `requestAnimationFrame`. Every animation is a MotionRuntime
  tween/sequence, every tap a `ButtonController`, every modal a `WindowController`. The host ticks
  `core.update(frameMs)` and everything moves; `core.cancelAll()` settles everything.

## Installing in a game

```ts
import { Application } from 'pixi.js';
import { CoreRuntime, MotionRuntime, UiRuntime } from 'game-core';
import { HudView, LevelMapView, ResultWindowView, loadReadyUiAssets } from 'game-core/pixi';

const core = new CoreRuntime();
const motion = new MotionRuntime();
const ui = new UiRuntime({ motion });
core.registerRuntime('ui', ui);
core.registerRuntime('motion', motion);
app.ticker.add((t) => core.update(t.deltaMS));           // the host owns the clock

// serve game-core/assets/pixi-ui/ from any URL and point the loader at it
const textures = await loadReadyUiAssets({ baseUrl: '/pixi-ui/' });

const hud = new HudView({ ui, motion, textures, coins: 12450, lives: 3, maxLives: 5,
  onCoinsTap: openShop, onLivesTap: openLives, onSettingsTap: openSettings });

const map = new LevelMapView({ ui, motion, textures,
  levels: [{ index: 1, stars: 3 }, { index: 2, stars: 2, hard: true }, /* … */],
  currentLevel: 19,
  onSelectLevel: (level, state) => startLevel(level, state === 'completed'),
  onLockedTap: (level) => toast(`Level ${level} is locked`),
  onFocusChange: ({ selectedLevel }) => playButton.setLabel(`LEVEL ${selectedLevel}`) });

const result = new ResultWindowView({ ui, motion, textures,
  onNext: (p) => goToNextLevel(p.level), onRetry: (p) => restart(p.level) });

app.stage.addChild(map, hud, result);
app.renderer.on('resize', () => {
  const { width: w, height: h } = app.screen;
  hud.resize(w, h, { insets: { top: safe.top }, pixelRatio: app.renderer.resolution });
  map.resize(w, h, { insets: { top: hud.barHeight, bottom: bottomBarHeight }, pixelRatio: app.renderer.resolution });
  result.resize(w, h, { insets: safe, pixelRatio: app.renderer.resolution });
});

result.show({ level: 19, stars: 2, rewardCoins: 100 });   // WindowController lifecycle inside
```

Copy or serve `game-core/assets/pixi-ui/**` (69 webp files + `fonts/FiraSans-Black.woff2`,
~1.3 MB); `READY_UI_ASSET_FILES` lists them so a build step can bundle them. `package.json`
also exposes them as `game-core/assets/pixi-ui/...` for hosts that import asset URLs.

## Components

All views are `pixi.js` `Container`s laid out in **viewport CSS px** through `resize(width,
height, { insets, pixelRatio })`. Internally they compose in the donor's design units under a
contain-fit scale of the portrait design box (1080 × 2344), so a node keeps the same share of the
screen on a 320 px phone, an iPhone and a desktop window; canvas text is re-rasterised at twice
the final on-screen density (`applyTextResolution`, see Render quality) so it stays crisp under
scaling.

### LevelMapView

The Trail Arrow scroll ribbon: badges (`badge_base` / `badge_current` / `badge_locked`), gold
stars, locks, the red HARD pill, the rail between levels, the focus glow. Levels climb upward.

| Option / member | Meaning |
| --- | --- |
| `levels: LevelMapLevel[] \| number`, `currentLevel` | data; `index < current` = completed, `=` current, `>` locked |
| `onSelectLevel(level, 'completed' \| 'current')` | settled tap on an open badge (a swipe is never a tap) |
| `onLockedTap(level)` | tap on a locked badge (it shakes) |
| `onFocusChange({ focusLevel, selectedLevel })` | while scrolling; `selectedLevel` = focus clamped to open levels (feed a PLAY button) |
| `resize(w, h, { insets, pixelRatio })` | reserve HUD/buttons/safe area; keeps the focused level in place |
| `scrollToLevel(level, animate = true)` | MotionRuntime tween (scope `<id>:scroll`) or instant |
| `setProgress({ levels, currentLevel })`, `setLevelStars(level, stars)` | update after a win |
| `focusLevel`, `selectedLevel`, `levelScreenY(level)`, `getNodeContainer(level)`, `focusPoint` | for host FX (coin flights, unlock effects) |
| `buildWindow` (default 40) | nodes built around the focus; long maps (1000+) stay cheap and extend while scrolling |
| `destroy()` | disposes every ButtonController, cancels motion scopes, removes listeners |

Interaction: drag anywhere inside the map, release to fling with a projected snap to the nearest
level; wheel scrolls and snaps; each badge is a `ButtonController` (tap threshold 14 px) so a
press cancelled by a swipe, `cancelScope` or `core.cancelAll()` never fires `onSelectLevel`.
Culling hides off-screen nodes; nothing is created or destroyed per frame. Geometry is the
donor's: contain scale × 0.963 (its progression scale on a phone), 300-unit badges × 1.215,
537-unit gap, the focused badge at 60% of the screen height but always a whole badge clear of
the bottom inset (PLAY) and the HUD.

### HudView

Lives (heart with the count inside, timer / `MAX` on the capsule, "+"), coins (capsule counter,
"+"), an optional **stars** badge (gold star, total count, not tappable) and the settings gear on
its dark back, laid out with the donor's rule: row area = 1/20 of the viewport in portrait (1/50
landscape), never wider than the screen minus the margins, heart icon 60 design units from the
left and 83 from the top. `setCoins(n)`, `setLives(n, timerText)`, `setLivesTimer(text)`,
`setMaxLives(n)`, `setStars(n)`, `barHeight` (px to reserve), `coinAnchor` / `starAnchor` (world
positions for flight effects). Counter changes pulse through MotionRuntime.

### UiButton

Sprite background + optional label/icon; Pixi pointer events → `ButtonController`, press progress
→ scale from an explicit idle scale (`setIdleScale`). `setLabel`, `setEnabled`, `setTapThreshold`,
`controller`.

### ModalWindow → the windows

`ModalWindow` is the base and reproduces the donor's WindowsSystem: a dim backdrop (black 0.55;
tap = `close('background')`), a panel composed in design units around its own origin, scaled so
its **measured** bounds fit `fit.widthRatio × fit.heightRatio` of the safe area (default 0.88 ×
0.84, the donor's mobile ratios), origin at the safe-area center; a `WindowController` with the
donor's pop entrance (320 ms `backOut(1.5)`: alpha 0→1, y +60→0, scale 0.84→1) and a 160 ms
leave; the 51-unit red × at each window's donor coordinates. `show(params)`,
`close(reason, onClosed?)`, `state`, `resize`, `destroy`; `onBeforeClose` can veto, `onHidden` is
view cleanup only, `onDismiss(reason)` runs after × / backdrop closes.

Every window below is laid out from the donor's generated prefab + its runtime adjustments
(positions, sizes, font sizes and strokes are the donor's numbers):

- **ResultWindowView** — LevelComplete: ribbon at y −317 with `LEVEL n` / `COMPLETED!`,
  `REWARDS` caption, big coin with the amount under it, green CONTINUE (−230, 310), yellow
  secondary (230, 310), × at (445, −369); slate 0.94 backdrop and the 440 ms `backOut(1.9)`
  victory pop. Optional stars crown the ribbon. `onNext` / `onRetry` are **close
  continuations**: only after the window is hidden, never on cancel.
- **LivesWindowView** — RefillHearts: 968 × 1070 purple panel, inner 900 × 382 panel, heart
  at x −261 with `n/max`, `Next heart in` + countdown (`setTimer` while open; `MAX` when full),
  REFILL with the coin price and a "+1 for an ad" button at y 350; `onRefill`, `onWatchAd`.
- **ShopWindowView** — the donor's **full-screen** shop: striped awning tiled across the top
  (36/255 of the height), the 89-unit × at the top-right, then the blue `SPECIAL OFFER` ribbon
  and a 3-column grid of 318 × 418 pack cards (amount on top, coin pile, price on the bottom band)
  scaled to the screen width minus 2 × 32, scrollable when it overflows; `onBuy(item)`.
- **SettingsWindowView** — 968 × 1102 panel, `SETTINGS`, SOUND / MUSIC toggles (blue squares
  300 apart at y 45, labels above, red slash when off; HAPTIC optional), version caption,
  optional in-level HOME / RESTART; `onToggle(setting, enabled)` fires in place, home/restart
  are continuations. `setSettings`, `currentSettings`.
- **NoAdsWindowView** — 975 × 1355 blue panel with the crossed clapperboard, `NO` / `ADS`
  rotated −32° over the corner, description band at y 248, green price button at y 517;
  `onBuy(params)` continuation, no purchase logic inside.
- **StarterPackWindowView** — 975 × 1355 warm panel, the chest hero, `STARTER PACK` rotated
  −14°, rewards row (coins, ∞-lives duration), red booster bar with the bulb, price button at
  y 542; configurable `rewards` / `title`, `onBuy(params)` continuation. Ready for a future
  OfferRuntime: everything shown is data.

Only one window is active per `UiRuntime` at a time (foundation rule); `ui.isBlocking()` is true
while any of them is open.

### ClickRippleEffect (Pixi FX)

The production "ocean" of Trail Arrow (`ArrowRenderer.spawnOceanRipple`: rings from a tap on empty
space) as a reusable effect (`src/pixi/fx/`). It is a `Container` the host places where the rings
should draw (inside the zoomed world like the donor, or over the play field under the modals):

```ts
const ripple = new ClickRippleEffect({ motion, id: 'game' });   // defaults = the production ocean
world.addChild(ripple);                                          // rings pan with the world, keep their screen size
app.stage.on('pointerup', (e) => { if (isEmptyTap(e)) ripple.spawnGlobal(e.global.x, e.global.y); });
```

`DEFAULT_CLICK_RIPPLE` is the donor 1:1: two white rings with phases `[0, 0.18]`, radius 10 → 56 px,
stroke 3 → 1.2 px, alpha 0.6 → 0, linear, 620 ms in total (the second ring is born at 111.6 ms and
both end together), no halo, normal blending, at most 8 ripples, sizes in screen px.

| Member | Meaning |
| --- | --- |
| `spawn(x, y, { color?, sizeScale? })` | ripple at the effect's **local** point; returns a handle (`active`, `cancel()`) or null after destroy |
| `spawnGlobal(x, y, …)` | the same from a Pixi global (screen) point, converted through the container's transform — absorbs a stage offset or a scaled world |
| `configure(partial)` | changes future spawns (ripples in flight keep their settings); invalid values throw `RangeError` |
| `setSizeScale(k)` / `sizeScale` | extra multiplier on every radius and stroke width, on top of `sizeSpace` |
| `prewarm(n)`, `cancelAll()`, `getStats()` | pool warm-up; cancel everything; `activeRipples / activeRings / pooledRings / createdRings / spawned / completed / cancelled / recycled` |
| `scope` | `fx:click-ripple:<id>` — every ripple is one linear MotionRuntime tween there, so `core.pauseScope` / `cancelScope` / `cancelAll` apply |
| `destroy()` | cancels the tweens, destroys every ring, never calls back afterwards; idempotent |

`ClickRippleConfig` (all defaults in `DEFAULT_CLICK_RIPPLE`):

- `ringPhases` — the phase semantics of the donor: over the ripple's lifetime t ∈ [0, 1] ring i runs
  `k = clamp((t − phase_i) / (1 − phase_i))`, so a later phase starts later but **every ring ends
  together** at t = 1; a phased ring stays hidden until its phase. The array length is the ring
  count. `[0, 0.18]` is production; `[0, 0.3, 0.6]` gives three rings ending together.
- `durationMs` — the total lifetime of a ripple (620); `startRadius` → `endRadius`, `lineWidth` →
  `lineWidthEnd`, `alpha` → 0 with `radiusEase` / `alphaEase` (ease names mean the same as in
  MotionRuntime; production is linear: alpha = 0.6 × (1 − k), width = 3 − 1.8k).
- `sizeSpace` — `screen` (production): radii and widths are screen px and the effect divides them
  by its own world scale every frame (`getGlobalTransform`, clamped at 0.05 like the donor), so a
  ripple keeps the same on-screen size under a pinch-zoomed world or inside a contain-fit UI layer,
  wherever the host parents it; `local`: plain local units.
- extras that stay off in production: `ringAlphaDecay` (each later ring dimmer; 1), `haloColor` /
  `haloAlpha` / `haloWidth` (a wider dark stroke under the ring for light backgrounds; alpha 0),
  `blendMode` (`normal`), `color` (white).
- `maxActive` (8): spawning past it recycles the oldest ripple, never the newest tap.

Rings are pooled `Graphics` (never more than `maxActive × rings`, nothing allocated per frame); a
live ring is redrawn on every tween update. There is no ticker, timer or requestAnimationFrame
inside: the host's `core.update(frameMs)` is the only clock.

**What stays in the host** (deliberately not in Core): deciding which pointer-up is "a tap on empty
space". In Trail Arrow that is the ArrowRenderer's pinch/pan state, its 12 px pan threshold and
`arrowAtLoose` (a tap near an arrow is an arrow tap, never a ripple) — all game-specific. The
showcase's rule — the press landed on a free surface (the stage or the map's empty ribbon, never a
button / badge / window / toolbar), no window is blocking, and the pointer did not travel more
than 12 px — lives in `examples/pixi-showcase/main.ts`. A game whose world is offset or zoomed
parents the effect inside that world (rings pan with it, `sizeSpace: 'screen'` keeps them the
same size on screen) and calls `spawnGlobal`.

Parity proof: `npm run ocean:compare` (`scripts/ocean-compare.mjs`, needs the donor dev server as
`DONOR_URL` and the showcase as `SHOWCASE_URL`) boots both apps under one virtual clock, taps
empty space in each, steps both 1/60 s at a time and measures ring radius / width / alpha from the
pixels at 17, 133 (second ring born), 317, 550 and 633 ms (gone); it also fires 9 taps in 9 frames
(cap 8, oldest recycled, pool never grows) and checks pool reuse. Crops and a side-by-side montage
land in `showcase-shots/ocean/`.

### Theme

`resolveTheme(overrides)` merges one level deep over `DEFAULT_READY_UI_THEME`: font family,
text fill/stroke, backdrop color, level-map geometry (badge size, node scale, gap, focus boost,
focus ratio) and the design box. It is deliberately small — the default looks right out of the box.

## Render quality (Retina)

Both the donor and the showcase render at `resolution = min(max(devicePixelRatio, 1), 2)` with
`autoDensity` and MSAA; sprites are minified from the same source art with mipmaps (PixiJS 8
recomputes `mipLevelCount` at upload when `autoGenerateMipmaps` is set). The one real difference
was text: the donor rasterises canvas text at the renderer resolution and lets the GPU minify it
2–3×, which reads crisper on Retina than text rasterised at exactly its on-screen density. The kit
now supersamples labels the same way (`applyTextResolution` uses `TEXT_SUPERSAMPLE = 2` × the
final density, capped at 4).

## Donor parity check

```bash
# from the workspace root, READ ONLY on trail_arrow:
sh -c "cd trail_arrow && npx vite --mode localhost --host 0.0.0.0 --port 8090"
DONOR_URL=http://127.0.0.1:8090/ node scripts/donor-compare.mjs
```

`scripts/donor-compare.mjs` seeds a level-19 profile into the donor's localStorage, opens its
main screen and every window at 390 × 844 @2x and writes `showcase-shots/donor/*.png` plus
`*.json` scene dumps (positions, scales, screen bounds, font sizes) — the numbers the kit's
layouts are taken from. Compare them side by side with `npm run showcase:shots`.

## Showcase

```bash
npm run showcase -- --host 0.0.0.0        # Vite dev server, examples/pixi-showcase
```

Opens **GAME CORE UI SHOWCASE**: the production Ready UI as a game scene — HUD (lives / coins /
stars / settings), a 36-level map (stars 0..3, hard pills, current, locked), the donor-sized
PLAY button, the starter-pack and no-ads offer icons — and, separated at the very bottom, a
flat DEMO TOOLBAR that opens each window directly (RESULT · SHOP · LIVES · SETTINGS · NO ADS ·
OFFER) and a RIPPLE pill (the production ocean · the same with the demo halo for light backgrounds
· off). A tap on free space (the stage or the map's empty ribbon) spawns the production ripple;
taps the UI consumes and map scrolls never do. A win on the current level unlocks the next one and
scrolls to it. Demo data only (`examples/pixi-showcase/demoData.ts`). `window.__showcase` exposes
the views, the ripple effect and the runtimes.

Visual checks (the sandboxed in-app browser has no WebGL; use the installed Google Chrome):

```bash
SHOWCASE_URL=http://127.0.0.1:5180/ npm run showcase:shots   # Playwright, channel 'chrome'
```

writes `showcase-shots/*.png` for 390 × 844 (map, the production ripple on the dark map and the
halo demo on a light canvas, scrolled, locked, hard pill, every window), 320 × 568 (map + windows) and 1280 × 800 (map,
OCEAN ripple preset), drives a real tap on free space (rings spawn; a toolbar pill, an open window
and a level badge must not), a real drag (no ripple), a real CONTINUE tap, a real SOUND toggle and
`core.cancelAll()`, and fails on any unexpected console error. Ripple frames are captured with the
host clock frozen and stepped by hand, so the shots are deterministic on SwiftShader.

## Tests

`tests/pixi/` runs the kit headlessly in Vitest (a tiny fake canvas 2D context behind Pixi's
`DOMAdapter`, `Texture.WHITE` for art): public entry and package wiring, level data mapping and
states, selection vs swipe, scroll/focus positioning, resize, `setProgress`, windowed builds,
destroy/listener cleanup, `cancelAll` never firing business callbacks, HUD counters/taps/layout,
window lifecycles and close continuations, and the click ripple (production defaults, a frame-by-
frame check against the donor formula transcribed from `ArrowRenderer.updateOceanRipples`, both
rings ending together, pool reuse, `maxActive = 8` recycling, screen-space sizing under a zoomed
world, global → local coordinates, `configure` validation, pause/resume/cancel through the motion
scope, destroy with no callbacks afterwards).

## Assets (provenance)

Extracted from Trail Arrow (`trail_arrow/public/assets/**` and its texture atlases) into
`assets/pixi-ui/` (69 files, ~1.3 MB): level badges/stars/lock/pill (`level/`), the level-select
background and top shadow (`bg/`), the Figma top bar (`hud/`), buttons (`button/`), icons
(`icons/`), the victory ribbon and purple panels (`window/`), shop awning/cards/coins (`shop/`),
settings panel/toggles/buttons (`settings/`), the no-ads and starter-pack panels, heroes, icons
and the bulb (`offer/`), and Fira Sans Black. No runtime dependency on `trail_arrow/` remains.
