# Game Core · Pixi Ready UI

`game-core/pixi` is the ready-made, drawn UI layer of Game Core for PixiJS 8 hosts. A game plugs
in its data (levels, progress, coins, lives, callbacks) and gets a finished, animated interface:
level map, HUD, result / lives / shop windows. The art and geometry come from Trail Arrow and now
live physically inside this package (`assets/pixi-ui/`); the behaviour runs on the renderer-agnostic
foundation (`UiRuntime`, `MotionRuntime`, `CoreRuntime`).

```
game-core
├── "game-core"        renderer-agnostic: CoreRuntime, FxRuntime, MotionRuntime, UiRuntime
└── "game-core/pixi"   Pixi Ready UI: LevelMapView, HudView, UiButton, ModalWindow,
                       ResultWindowView, LivesWindowView, ShopWindowView, assets loader, theme
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

Copy or serve `game-core/assets/pixi-ui/**` (45 webp files + `fonts/FiraSans-Black.woff2`,
~600 KB); `READY_UI_ASSET_FILES` lists them so a build step can bundle them. `package.json`
also exposes them as `game-core/assets/pixi-ui/...` for hosts that import asset URLs.

## Components

All views are `pixi.js` `Container`s laid out in **viewport CSS px** through `resize(width,
height, { insets, pixelRatio })`. Internally they compose in the donor's design units under a
contain-fit scale of the portrait design box (1080 × 2344), so a node keeps the same share of the
screen on a 320 px phone, an iPhone and a desktop window; canvas text is re-rasterised at the
final on-screen density (`applyTextResolution`) so it stays crisp under scaling.

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
Culling hides off-screen nodes; nothing is created or destroyed per frame.

### HudView

Lives (heart with the count inside, timer / `MAX` on the capsule, "+"), coins (capsule counter,
"+") and a settings gear, along the top safe edge; the whole badge is a `UiButton`.
`setCoins(n)`, `setLives(n, timerText)`, `setLivesTimer(text)`, `setMaxLives(n)`, `barHeight`
(px to reserve), `coinAnchor` (world position for coin flights). Counter changes pulse through
MotionRuntime.

### UiButton

Sprite background + optional label/icon; Pixi pointer events → `ButtonController`, press progress
→ scale from an explicit idle scale (`setIdleScale`). `setLabel`, `setEnabled`, `setTapThreshold`,
`controller`.

### ModalWindow → ResultWindowView, LivesWindowView, ShopWindowView

`ModalWindow` is the base: dim backdrop (tap = `close('background')`), a design-unit panel
contain-fitted into the viewport, a red × (`<id>:close`), and a `WindowController` with the
donor's entrance (440 ms `backOut(1.9)`: alpha 0→1, y +130→0, scale 0.7→1) and a 160 ms leave.
`show(params)`, `close(reason, onClosed?)`, `state`, `resize`, `destroy`; `onBeforeClose` can veto,
`onHidden` is view cleanup only, `onDismiss(reason)` runs after × / backdrop closes.

- **ResultWindowView** — victory ribbon with `LEVEL n` / `COMPLETED!`, three stars popping in,
  reward coins, NEXT / RETRY, ×. `onNext(params)` / `onRetry(params)` run as **close
  continuations**: only after the window is hidden, never on cancel.
- **LivesWindowView** — purple info panel: big heart `n/max`, `NEXT HEART IN` + timer
  (`setTimer` while open), REFILL NOW (coin price) and an optional "+1 for an ad" button;
  `onRefill`, `onWatchAd` continuations.
- **ShopWindowView** — striped awning, up to six pack cards (coin pile, amount, green BUY with
  the price); `onBuy(item)` continuation.

Only one window is active per `UiRuntime` at a time (foundation rule); `ui.isBlocking()` is true
while any of them is open.

### Theme

`resolveTheme(overrides)` merges one level deep over `DEFAULT_READY_UI_THEME`: font family,
text fill/stroke, backdrop color, level-map geometry (badge size, node scale, gap, focus boost,
focus ratio) and the design box. It is deliberately small — the default looks right out of the box.

## Showcase

```bash
npm run showcase -- --host 0.0.0.0        # Vite dev server, examples/pixi-showcase
```

Opens **GAME CORE UI SHOWCASE**: HUD, a 36-level map (stars 0..3, hard pills, current, locked),
PLAY (launches the focused level), RESULT / SHOP / LIVES buttons; a win on the current level
unlocks the next one and scrolls to it. Demo data only (`examples/pixi-showcase/demoData.ts`).
`window.__showcase` exposes the views and runtimes for automated checks.

Visual checks (the sandboxed in-app browser has no WebGL; use the installed Google Chrome):

```bash
SHOWCASE_URL=http://127.0.0.1:5180/ npm run showcase:shots   # Playwright, channel 'chrome'
```

writes `showcase-shots/*.png` for 390 × 844, 320 × 568 and 1280 × 800, drives a real drag, a
real NEXT tap and `core.cancelAll()`, and fails on any unexpected console error.

## Tests

`tests/pixi/` runs the kit headlessly in Vitest (a tiny fake canvas 2D context behind Pixi's
`DOMAdapter`, `Texture.WHITE` for art): public entry and package wiring, level data mapping and
states, selection vs swipe, scroll/focus positioning, resize, `setProgress`, windowed builds,
destroy/listener cleanup, `cancelAll` never firing business callbacks, HUD counters/taps/layout,
window lifecycles and close continuations.

## Assets (provenance)

Extracted from Trail Arrow (`trail_arrow/public/assets/**` and its texture atlases) into
`assets/pixi-ui/`: level badges/stars/lock/pill (`level/`), the level-select background and top
shadow (`bg/`), the Figma top bar (`hud/`), buttons (`button/`), icons (`icons/`), the victory
ribbon and purple panels (`window/`), shop awning/cards/coins (`shop/`), and Fira Sans Black.
No runtime dependency on `trail_arrow/` remains.
