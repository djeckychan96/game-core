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
└── "game-core/pixi"   Pixi Ready UI: LevelMapView, HudView, BottomNavView, LevelMapScreen, ShopScreen, MovesView, SettingsButtonView, UiButton, ModalWindow,
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
  duplicated core code. Its declarations name the root's own types (`dist/pixi/pixi/*.d.ts`
  import `dist/index.d.ts`, no second copy), so a TypeScript host passes `game-core` instances to
  `game-core/pixi` with no cast; `scripts/check-pixi-types.mjs` compiles such a host against `dist`.
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

## ReadyUiOverlay — the Ready UI over a game that is not Pixi (v0.9)

A game drawn with DOM, Three.js or any other renderer has no Pixi Application to put the views on.
`createReadyUiOverlay` is that host infrastructure, extracted from the Gorodki integration, where it
was about a third of `game-core-ui.js` (62 of its 197 non-blank lines: the safe-area probe, ticker
disarming, Application init, canvas mount, asset load, hit test, renderer resize, update / render /
dispose). The other two thirds there — views, callbacks, layout numbers, screens — are game-specific
and stay in a game. The overlay knows nothing about a game.

```ts
import { CoreRuntime, MotionRuntime, UiRuntime } from 'game-core';
import { HudView, createReadyUiOverlay } from 'game-core/pixi';

const core = new CoreRuntime(), motion = new MotionRuntime(), ui = new UiRuntime({ motion });
core.registerRuntime('motion', motion); core.registerRuntime('ui', ui);

const overlay = await createReadyUiOverlay({ container, core, ui, assets: { baseUrl: '/pixi-ui/' } });
const hud = overlay.add(new HudView({ ui, motion, textures: overlay.textures, /* … */ }));

function layout() {                                       // the host calls it: window resize, orientation change
  const { width, height, safeArea, resolution } = overlay.resize();
  hud.resize(width, height, { insets: safeArea, pixelRatio: resolution });
  overlay.setInteractiveRegions([{ x: 0, y: 0, width, height: hud.barHeight }]);
}
function frame(frameMs) { game.update(frameMs); overlay.update(frameMs); }   // the game's existing loop
// … overlay.dispose() on teardown
```

| Concern | Behavior |
| --- | --- |
| **Clock** | Host-driven, one frame source. `overlay.update(frameMs)` = `core.update` (optional) → Pixi's global `Ticker.system` / `Ticker.shared` on a clock made of the host's frame times → modal sync → one `app.render()`. The Application never starts its ticker; the global tickers are disarmed BEFORE `init` (the renderer's scheduler would auto-start a second rAF loop) and given back by `dispose()`. `driveSharedTickers: false` leaves them alone for a page that already runs another Pixi application. No `requestAnimationFrame`, timer, observer or `window` / `document` listener is created. |
| **DOM** | One wrapper (`overlay.layer`, `data-game-core="ready-ui-overlay"`, `z-index` option, default 10) appended as the container's last child: the transparent render canvas (`pointer-events: none`, always), a transparent hit layer Pixi listens on, the safe-area probe. The container must establish a containing block; it and the gameplay DOM are never restyled. `document.body` = the full-viewport case (`position: fixed`, window size). |
| **Input** | Native hit testing, no synthetic events: `'passthrough'` — the hit layer takes nothing, every tap / drag / click / wheel is the gameplay's; `'ui'` (default) — it exists only inside `setInteractiveRegions([...])` (rectangles or Pixi objects, re-read on `resize()`; CSS `clip-path`), the rest passes through; `'modal'` — it covers everything. While the optional `ui` runtime reports `isBlocking()` the effective mode is `'modal'` (synced in `update()`); full-screen screens (a level map) call `setInputMode('modal')` themselves. `overlay.isBlocking` is the gameplay gate, `overlay.hitTest(clientX, clientY)` serves coordinate-based games (Gorodki). A listener DELEGATED to the container still sees taps the Ready UI took, with `event.target === overlay.hitLayer`. |
| **Resize** | Host-callable `overlay.resize(width?, height?)`: measures the container, re-reads the DPR (clamped to `maxResolution`, default 2) and the safe area (CSS `env()` clipped to the overlay's box, or the `safeArea` option), returns `{ width, height, resolution, safeArea }` for the views. No `ResizeObserver`. |
| **Assets** | `loadReadyUiAssets(options.assets)` in parallel with the renderer init → `overlay.textures`; `textures` passes an already loaded record; `assets: false` loads nothing. A failed creation leaves no canvas and the tickers as they were. |
| **Views** | `overlay.add(view)` / `remove(view)` on one `overlay.root` container; screens and navigation stay in the game. |
| **Dispose** | Removes the layer, destroys the Application with the views still on `root`, returns the global tickers; repeat-safe; `update` / `resize` afterwards are no-ops. The host stops laying out its destroyed views. |

Proof: `npm run showcase:overlay` — `examples/pixi-showcase/overlay.html` (the Ready UI over a draggable DOM
card and a DOM button, the host's single rAF loop) on the installed Chrome: every animation frame is
requested by the host loop (0 by PixiJS), a DOM click and a DOM drag pass through, the HUD region and a
Pixi button take their taps, a window opened by a real gear tap blocks the DOM until it closes,
`'passthrough'`, an orientation flip, a double `dispose()`.

## Components

All views are `pixi.js` `Container`s laid out in **viewport CSS px** through `resize(width,
height, { insets, pixelRatio })`. Internally they compose in the donor's design units under a
contain-fit scale of the portrait design box (1080 × 2344), so a node keeps the same share of the
screen on a 320 px phone, an iPhone and a desktop window; canvas text is re-rasterised at twice
the final on-screen density (`applyTextResolution`, see Render quality) so it stays crisp under
scaling.

### Localization

Ready UI accepts an optional immutable `LocalizationTextProvider`. A host creates one runtime after
`await platform.ready()` from `platform.environment.language()`, merges the exported
`READY_UI_CATALOGS` with its `game.*` catalogs, and passes the same provider to Core and game UI.
Views resolve text as explicit option/param → provider → exact legacy default; `UiButton` receives
only final display strings. Locale and UI Skin V1 remain independent. The showcase-only manual QA
selector is `?locale=ru|en`.

See [LOCALIZATION.md](./LOCALIZATION.md) for boot order, fallback, diagnostics, catalog validation,
game-catalog composition and the browser proof command.

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
`setMaxLives(n)`, `setStars(n)`, `barHeight` (px to reserve: the bottom edge of the badge row plus the
donor's 12-unit margin, measured from the top of the viewport including the top inset), `coinAnchor` /
`starAnchor` (world positions for flight effects). Counter changes pulse through MotionRuntime.

The count on the heart and the timer / `MAX` on the capsule are shown together whenever the style's `hud.heartCount` is
set (Style 1 and, since theme_light_8, Style 2: white Carlito 98 with Style 2's #9b170b heart-number outline, centred on
the heart; theme_light_8's own `icon_bar` still draws the heart bare). Pure view: the host passes `setLives(n, timer)` /
`setLivesTimer(text)` from its LivesRuntime; nothing about regeneration lives in the HUD.

Layout geometry is never measured from animated sprites: every badge declares its design box as
Pixi's `boundsArea`, so `resize()` (the row's area fit, `barHeight`, `getBounds()` read by hosts)
sees the same numbers whether an icon is mid-pulse or a badge mid-press. A pulse tweens a factor
over the badge's own layout scale and a badge runs one pulse at a time: a burst of `setCoins()` calls
(reward coins flying in one by one) restarts the pop instead of stacking tweens whose captured
bases would compound and leave the icon enlarged.

`resourceFeedback: true` (opt-in; default off = the pop above, the number set at once) gives coins and lives a counter
feedback: a gain pops the icon and rolls the drawn number up to the new value (at most 12 redraws — a canvas `Text`
re-rasterizes on every change — 420–600 ms), a spend rolls it down in 260 ms while the icon dips to 0.9 and comes back,
and the heart (with its own number) gives a light shake (0.3 of the locked-level shake). `coinsAmount` / `livesAmount`
are the new value at once; only the drawn number trails it, a newer change goes on from the number on screen, a roll
cancelled from outside (`core.cancelAll()`, destroy) snaps it to its value, and `setCoins(n, false)` draws at once. The
lives caption (`MAX` / timer) and "+" follow the value at once. Stars keep the plain pop.

### BottomNavView

A generic bottom navigation bar (no donor art: it needs a style that covers `bottomNav` — Style 1 and Style 2). Items
are host data — `{ id, icon?: Texture | role, label? | labelKey?, locked?, disabled? }` — and routing stays with the host:

| Option / member | Meaning |
| --- | --- |
| `items`, `selectedId` | stable ids; the icon a texture or a style role (`'iconShop'`); `label` wins over `labelKey` (through `i18n`), neither = no label |
| `onSelect(id)` | settled tap on an item that is neither locked nor disabled, selected or not — the view never changes its own selection |
| `onLockedTap(id)` | settled tap on a locked item (it shows the style's lock instead of its icon, with its caption where the style's locked state has one); the item answers every such tap with the locked-level shake (left, right, back, 240 ms) when the view has `motion` |
| `disabled` | the item keeps its look (no style has disabled art) and is inert: no press feedback, no callback |
| `setSelected(id \| null)`, `setLocked(id, locked)`, `setDisabled(id, disabled)`, `selectedId`, `isLocked(id)`, `isDisabled(id)` | the host's routing result / unlocks |
| `resize(w, h, { insets, pixelRatio })`, `top`, `barHeight` | the panel `panelHeight` units above the bottom inset, reaching through it; slots `pitch` apart, shrinking on a narrow screen |

### LevelMapScreen

The level-map screen composition and its **one functional contract for every style**: `LevelMapView` (with the
style's background), PLAY, `BottomNavView` and `HudView`, bottom to top, laid out together — the HUD at the top, the
nav at the bottom edge, PLAY the style's distance above the nav, the map from the top inset down to PLAY. It owns no
game state, routing or timer — not a screen framework. Needs a style that covers `levelMapScreen` (Style 1, Style 2).

```ts
const screen = new LevelMapScreen({
  ...readyUi, id: 'map-screen',
  map: { levels, currentLevel },                     // a node tap SELECTS its level (scrolls it under the focus)
  hud: { coins, lives, maxLives, onLivesTap, onSettingsTap },
  nav: {
    shop: { onTap: openShop },                       // or no onTap / disabled: true = drawn, inert
    home: { onTap: () => screen.map.scrollToLevel(currentLevel) },
    lock: {}                                         // the future feature: the style's locked state; a tap shakes it, callback optional
  },
  playBreathing: true,                               // opt-in: PLAY breathes (UI_BUTTON_BREATHING)
  onPlay: (level) => startLevel(level)               // PLAY launches the selected level
});
```

| Contract | Meaning |
| --- | --- |
| select level | `map.selectedLevel` / `screen.playLevel` = the playable level under the focus (scroll, fling, or a tap on an open node, which scrolls it there); PLAY shows `core.level_map.play` (+ `core.level_map.level` when the style draws a level line) |
| `onPlay(level)` | settled tap on PLAY with the selected level |
| `nav.shop` / `nav.home` / `nav.lock` | `{ onTap?, disabled?, label? }`: SHOP \| HOME \| LOCK, always all three, HOME selected, LOCK locked; a SHOP / HOME slot without `onTap` is disabled for good (inert); LOCK stays tappable without `onTap` — a tap shakes it and reaches its `onTap` when there is one — and only `disabled: true` makes it inert; `disabled: true` with an `onTap` starts a slot disabled and `screen.nav.setDisabled(id, false)` enables it later; captions `core.nav.shop` / `home` / `lock` or `label` |
| `playBreathing` (optional) | opt-in idle breathing of PLAY: `true` = `UI_BUTTON_BREATHING` (×1.04 over 1.3 s, a soft sine), or `{ scale?, periodMs? }`; default off; `screen.play.setBreathing(false)` stops it |
| `map.onSelectLevel` (optional) | still told about every node tap, as before — a host that launched from the node keeps working |
| `nav: { items, selectedId, onSelect, onLockedTap }` | the earlier generic item list, kept |

The style decides only the look (files, boxes, caption look, whether PLAY has a level line) — never whether PLAY or a
slot exists. A host that launches straight from a node uses `LevelMapView` alone: its node tap still calls
`onSelectLevel` and nothing else.

### ShopScreen

The shop **tab** of the main-screen navigation (theme_light_6 `market_screen_light` 28:46095 / `market_screen_dark`
28:46015, docs/figma/theme-light-6-shop): a full-screen, opaque, **non-modal** screen — the style's background, the
awning across the top, the title tape, a grid of pack cards (three per row, scrolling when they do not fit) and the same
SHOP | HOME | LOCK navigation as LevelMapScreen with SHOP selected. Needs a style that covers `shopScreen` (Style 1,
Style 2). It is not a window: no dim, no WindowController, `ui.isBlocking()` stays false, and it is never drawn over the
map — the host shows it **instead of** the map screen. Both screens stay alive, so the map, its scroll, its selection and
the progress are never rebuilt by a tab switch.

```ts
const shop = new ShopScreen({
  ...readyUi, id: 'shop-tab', hidden: true,
  items: catalog.map((p) => ({ id: p.id, amount: p.coins, price: p.priceText })),   // the host's products, never Core's
  onBuy: (item) => { shop.setBuyEnabled(false); purchases.purchase(item.id, 'shop').finally(() => shop.setBuyEnabled(true)); }, // PurchaseRuntime
  onClose: () => showTab('home'),                                                     // the × (drawn only with it)
  nav: { home: { onTap: () => showTab('home') }, lock: {} }
});
const mapScreen = new LevelMapScreen({ ...readyUi, /* … */ nav: { shop: { onTap: () => showTab('shop') }, home: { onTap: … }, lock: {} },
  hud: { /* … */ onCoinsTap: () => showTab('shop') } });
function showTab(tab: 'shop' | 'home') {                                              // routing stays the host's
  if (tab === 'shop') shop.show({ onShown: () => { mapScreen.visible = false; } });   // the entrance over the map
  else { mapScreen.visible = true; shop.hide(); }                                     // the map back under the leave
}
```

`show()` / `hide()` animate (theme_light_8 has no motion spec; Core's): the entrance (380 ms) slides the awning and the ×
down from above the viewport, fades the background and the navigation in and lifts the title, then the card rows, into
place (row by row); the leave (300 ms) runs it backwards — cards first, the background last, then the tab is invisible.
One progress, one MotionRuntime tween (scope `<id>:transition`), plain alpha / position writes (no filters). A call in
the other direction turns it round from where it is (its time scaled by the distance left), so rapid SHOP / HOME taps
never hang or leave it half drawn; `core.cancelAll()` lands it where it was going; `destroy()` cancels it. While open or
opening the screen takes every tap over it (nothing under it is reached); from `hide()` on it takes none, so the map
shown under it gets its taps at once, and no card / × reports. Routing as above: keep the map drawn while the tab comes
in (hide it in `onShown`), show it before `hide()`. A host that hides its map first and shows the tab still works (the
tab then fades in over an empty stage).

| Option / member | Meaning |
| --- | --- |
| `items: ShopScreenItem[]`, `setItems(items)`, `items` | the host's packs in card order: `ShopItem` (`id`, `amount`, already-localized `price`) + `icon?` (a host texture, or a style role `shopPack1`…`shopPack6`; default the style's art for the slot, the sixth for later slots) + `available?` (`false` = inert, drawn with the style's inert look). Ids unique; a bad entry throws |
| `onBuy(item)` | settled tap on an available card while buying is enabled; the screen stays open — the purchase (PurchaseRuntime / the platform) is the host's |
| `setBuyEnabled(enabled)`, `buyEnabled` | holds every card (inert) while the host's purchase is in flight. The inert look is the style's `shopScreen.card.inertAlpha` (held / unavailable): Style 1 the donor's 85 % / 55 %; Style 2 none (1 / 1) — its #ffffff card face faded over the #0f172c fill read grey (85 % = #dbdcdf) |
| `onClose` | the style's ×, drawn only with it (e.g. back to the map) |
| `nav` | the LevelMapScreen slots `{ shop, home, lock }` (SHOP drawn selected; a SHOP / HOME slot without `onTap` is inert, LOCK shakes) or a generic item list; `screen.nav` is the BottomNavView |
| `title`, `setTitle(text)` | the tape's title; default `core.shop.title` (SHOP / МАГАЗИН) |
| `show({ animate?, onShown? })`, `hide({ animate?, onHidden? })`, `shown`, `state`, `hidden` (option) | the entrance / leave above (`animate: false` = at once; `hidden: true` starts hidden, no motion). `shown` = the tab is the current one (true from `show()`, false from `hide()` on); `state` = `hidden` \| `entering` \| `shown` \| `leaving`. `onShown` / `onHidden` run when that transition is over (at once when there is nothing to do); a turn-round drops the other direction's continuation (it never completed). `hide()` cancels a press, a drag or a fling in progress at once (never a purchase, never a late scroll) |
| `scrollY`, `scrollable`, `scrollToTop()` | the column scrolls (drag, fling through MotionRuntime scope `<id>:scroll`, wheel) only when the cards do not fit; a drag is never a purchase |
| `resize(w, h, { insets, pixelRatio })` | Figma's two compositions (theme_light_7 43:23372 / 43:25602): MOBILE — the phone frame at the safe width (the three cards ~90 % of it, the awning under the status bar, the × in its corner) while the designed two rows fit above the navigation; else DESKTOP — the contain-fit design scale (compact centred column), the awning raised 110 units, the × beside the title tape. The frame top on the viewport top, centred on the safe area; background and awning tiles span the viewport; the navigation keeps its own scale at the bottom |
| `getCardContainer(itemId)`, `destroy()` | a card for host FX / checks; destroy disposes every ButtonController, cancels the scroll, removes listeners (repeat-safe) |

The modal `ShopWindowView` below is a separate, unchanged view (donor look under every style).

### MovesView

The moves counter of a gameplay screen (no donor art: it needs a style that covers `moves` — Style 1 and Style 2, the
theme_light_6 MOVES box). Visual only: it knows nothing about `MoveRuntime` or a game — the host passes the number.

| Option / member | Meaning |
| --- | --- |
| `remaining`, `setRemaining(n)`, `remaining` (getter) | the number shown: a whole number ≥ 0 (a fraction floors, a negative / non-finite value shows 0); a long number shrinks into its box |
| `label` / `i18n` | the caption: explicit text, else `core.moves.label` (EN MOVES, RU ХОДЫ) |
| `hidden`, `show()`, `hide()`, `shown` | visibility only |
| `boxWidth`, `boxHeight` | the box's design size; the view's origin is the box centre — the host positions and scales it in its own composition |
| `setResolution(onScreenScale × devicePixelRatio)` | crisp text after the host scales it |

### SettingsButtonView

The settings button of a screen without a HudView gear — a gameplay screen (theme_light_6 draws it there only: a 214
square at top 90 / right 90). The style's `settingsButton` (`settingsButtonBack` + `settingsButtonIcon`, Style 1 and
Style 2) in the top-right corner of the safe area at the design contain-fit scale; no style = the donor HUD gear art at
the donor HUD's corner. `resize(w, h, { insets, pixelRatio })`: the position is the style's corner inside the given
insets — the gameplay composition stays the host's, so a host may offset it through `insets` (the UI gallery's demo
moves it under its HUD row on a narrow phone; that is the demo's layout, not a theme_light_6 rule). `onTap` is the
host's (open its Settings); no `onTap` = drawn, inert. It never opens a window itself. The map HUD's own gear
(`hud.gear`, HudView) is a separate, unchanged contract.

### UiButton

Sprite background + optional label/icon; Pixi pointer events → `ButtonController`, press progress
→ scale from an explicit idle scale (`setIdleScale`). `setLabel`, `setEnabled`, `setTapThreshold`,
`controller`.

Opt-in idle **breathing** for a primary call to action (`breathing: true | { scale?, periodMs? }` with `motion`, or
`setBreathing(…)` later; default `UI_BUTTON_BREATHING` = ×1.04 over 1.3 s, a half-sine yoyo with no spring). The scale
has one writer, the button: idle scale × breathing × press, so a press during a breath scales from the breathing size
and releases back to it. One owned tween (scope `ui:button:<id>:breathing`): it stops while the button is disabled and
on destroy, a breath cancelled from outside (`core.cancelAll()`) comes back on the next `setIdleScale` (every layout),
`setEnabled(true)` or `setBreathing`, and the hit area stays at its idle size on screen (the local point is scaled
back by the breathing factor).

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
  continuations**: only after the window is hidden, never on cancel. Styled (`theme.skin` covering `result`,
  Style 1): the style's red / grey ribbon per outcome, glow band, reward coin and 9-slice CTAs, the fail's
  life-lost art with `lifeDelta` (default `-1`, `null` = none) and its outcome line under it.
- **LivesWindowView** — RefillHearts: 968 × 1070 purple panel, inner 900 × 382 panel, heart
  at x −261 with `n/max`, `Next heart in` + countdown (`setTimer` while open; `MAX` when full),
  REFILL with the coin price and a "+1 for an ad" button at y 350; `onRefill`, `onWatchAd`. `refillOffer: false`
  (a game without a refill economy) hides REFILL, `adOffer: false` the ad button; the one shown takes the centre;
  styled with neither, their row closes up (the window ends under the heart / timer and is centred again).
  Styled: `show({ …, offer })` draws the style's OFFER panel under the window (see below), `onOffer(params)` is its buy
  continuation; without `offer` (or `onOffer`) the window is alone and centred as before.
- **ShopWindowView** — the donor's **full-screen** shop: striped awning tiled across the top
  (36/255 of the height), the 89-unit × at the top-right, then the blue `SPECIAL OFFER` ribbon
  and a 3-column grid of 318 × 418 pack cards (amount on top, coin pile, price on the bottom band)
  scaled to the screen width minus 2 × 32, scrollable when it overflows; `onBuy(item)`.
- **SettingsWindowView** — 968 × 1102 donor panel, `SETTINGS`, SOUND / MUSIC toggles (blue squares
  300 apart at y 45, labels above, red slash when off; HAPTIC optional), version caption,
  optional in-level HOME / RESTART; `onToggle(setting, enabled)` fires in place, home/restart
  are continuations. `setSettings`, `currentSettings`. Style 1 keeps this one generic View and
  selects its typed `map` / `gameplay` layout from `gameButtons`; these are layout/state variants,
  not separate View classes. Styled: an optional language row — `languages: [{ id, label }]` (two or more) +
  `onLanguage(locale)`, the current one by `show({ …, locale })` / `currentLocale`; the row shows the current
  language's name and a tap moves to the next (wrapping) in place, like a toggle; applying the locale is the host's.
  Every row a show does not draw (HOME / RESTART without its continuation, no languages) closes up.
- **NoAdsWindowView** — 975 × 1355 blue panel with the crossed clapperboard, `NO` / `ADS`
  rotated −32° over the corner, description band at y 248, green price button at y 517;
  `onBuy(params)` continuation, no purchase logic inside. Styled (a style covering `noAds`, theme_light_6
  `screen_ads_off`): the purple promo window, its ×, the rays and the hero, `wordNo` / `wordAds` as two title lines, the
  description's first line wrapping in its box and the rest as the note, the price on the style's green button — with the
  style's coin only for `show({ price, coinPrice: true })` (a game-coin price; a store price string stays alone). Same
  params, callbacks and copy keys.
- **StarterPackWindowView** — 975 × 1355 warm panel, the chest hero, `STARTER PACK` rotated
  −14° (a longer tier title shrinks to the donor's 430-unit cap), rewards row (coins, ∞-lives
  duration), red booster bar with the bulb, price button at y 542; configurable `rewards` /
  `title`, `onBuy(params)` continuation. Data-only hooks for an `OfferRuntime` host adapter:
  `setTimer(text)` draws the offer countdown under the header along its tilt (donor
  `layoutTimer`: half the header height + 40; empty text hides it), `setBuyEnabled(enabled)`
  blocks BUY while the host's purchase is in flight (donor `setPurchaseState`, alpha 0.85). The
  view holds no LiveOps logic and the kit never imports `OfferRuntime`.

Only one window is active per `UiRuntime` at a time (foundation rule); `ui.isBlocking()` is true
while any of them is open.

### OFFER panel (styled Lives / Confirm)

A style with `windows.offer` draws an OFFER panel under Lives and Confirm (theme_light_4: a pack offered instead of
waiting for a life or restarting). It is data only — `ReadyUiOffer` `{ title?, icon, iconLabel?, items?, price, badge? }`:
the hero is the style's `'offerLivesArt'` (unlimited lives) / `'offerCoinArt'` or a host texture, `items` are at most two
host icons with their counts (boosters are game content), `price` is a coin price on the buy button, `badge` the corner
text (`x3`, `-60%`; none = no badge). `LivesWindowView.show({ …, offer })` / `ConfirmWindowView.show({ offer })` with
`onOffer` set; the buy tap closes the window and runs `onOffer` (the purchase is the host's), the panel's × (when the
style draws one) closes the window like the window's ×. The panel sits on the window's horizontal centre, and the window
and the panel are centred together; a show without an offer builds nothing and keeps the window alone. The donor look and the pre-style `include` path never draw it.

```ts
lives.show({ lives, maxLives, timerText, refillPrice: 900,
  offer: { icon: 'offerLivesArt', iconLabel: '35d', items: [{ icon: lampTexture, label: '5' }, { icon: wandTexture, label: '10' }], price: 900, badge: 'x3' } });
restartConfirm.show({ offer: { icon: 'offerCoinArt', iconLabel: '2000', price: 900 } });
```

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

### UI styles (UI Skin V1)

A style is a typed **data package** (`ReadyUiSkin`, `src/pixi/skin.ts`): a stable `id`, its assets by
semantic role (file + 9-slice caps), its text look (OUTSIDE stroke, shadow offset) and dim, and the
layout of every Core view it `covers`. The view code is the same for every style. A game chooses one
style, once, in its Ready UI config — the theme it gives every covered view and the loader:

```ts
import { ConfirmWindowView, HudView, LevelMapView, LivesWindowView, ResultWindowView, SettingsWindowView, READY_UI_STYLE_1, loadReadyUiAssets } from 'game-core/pixi';

const READY_UI_THEME = { skin: READY_UI_STYLE_1 }; // the game's one style choice
const textures = await loadReadyUiAssets({ baseUrl: './pixi-ui/', skin: READY_UI_THEME.skin });
const readyUi = { ui, motion, textures, theme: READY_UI_THEME };
new ConfirmWindowView({ ...readyUi, id: 'exit-confirm', onConfirm });
new LivesWindowView({ ...readyUi, id: 'lives', onRefill, onWatchAd });
new SettingsWindowView({ ...readyUi, id: 'settings', onToggle, onHome, onRestart });
new HudView({ ...readyUi, id: 'hud' });
new LevelMapView({ ...readyUi, id: 'map', levels, currentLevel, onSelectLevel });
new ResultWindowView({ ...readyUi, id: 'result', onNext, onRetry, onExit });
```

| View | Style 1 (`READY_UI_STYLE_1`, id `style-1`) | Style 2 (`READY_UI_STYLE_2`, id `style-2`) |
| --- | --- | --- |
| ConfirmWindowView | covered — Figma `screen/confirm-exit` (docs/figma/confirm-exit); theme_light_4 Exit 22:28232 unchanged, Restart 22:28101 = the same window + the OFFER panel (docs/figma/style1-theme-light-4) | covered — theme_light_4 22:28984 Restart / 22:29021 Exit: the Style 2 popup (the Lives / Settings files), blur, `icon_heart_2` + runtime "-1", Carlito; one view, `action: 'restart' \| 'exit'` picks the copy; the orange OFFER under Restart (docs/figma/style2-theme-light-4) |
| LivesWindowView | covered — theme_light_4 22:27562 on the `screen/lives` art: the 990-unit window (REFILL NOW / GET +1 71 units higher) + the optional OFFER panel (docs/figma/style1-theme-light-4) | covered — theme_light_4 22:28924: the Settings popup at 756, blur, heart with the runtime count, green REFILL + price coin, orange GET with the tv and the heart "+1" on its corners, no highlight (`adHighlight: null`); the orange OFFER (docs/figma/style2-theme-light-4) |
| SettingsWindowView | covered — SOUND / MUSIC / optional HAPTIC, close, version, optional HOME / RESTART and the language row (Style 1's blue `Btn`, no Figma node) as one dense column (`map` / `gameplay`); theme_light_4 22:28430 type: SETTINGS 100, plain version, the violet shell × | covered — theme_light_4 22:28904 (in-level) / 22:28915 (map): Sound / Music (muted OFF button under the red slash), Restart level / Return home with icons, the Language row (`btn_main` + globe), no HAPTIC (`haptic: null`; asking for it throws) (docs/figma/style2-settings, docs/figma/style2-theme-light-4) |
| HudView | covered — exact lives / coins / gear Figma art; optional stars retain the existing Core semantics | covered — `theme_light_3` 8:23174: three bars, no gear, no count in the heart, `#3f598c` Carlito counters |
| LevelMapView | covered — exact blue / violet HARD nodes, lock, HARD surface, rail and current glow; numbers, localized HARD and rating stars remain runtime layers | covered — orange open / blue locked nodes, lock, light ray, earned stars, the sky background; no HARD art, no glow |
| BottomNavView, LevelMapScreen | covered — theme_light_5 24:37523 / 24:37548 + the dark nav components: PLAY without a level line, SHOP \| HOME \| LOCK with the raised blue column, #261a30-outlined captions (docs/figma/theme-light-5-level-map-nav) | covered — panel, raised selected column, lock; PLAY without wings (docs/figma/style2-level-map-screen); theme_light_5 24:38532 slot boxes, HOME selected, LOCK captioned (docs/figma/theme-light-5-level-map-nav); theme_light_8 46:35507…46:35531: the inactive icons' art drawn 220 (at 267 it ran into the captions) |
| ResultWindowView | covered — WIN theme_light_6 28:48286: the red ribbon with its black 45 % ×, no glow, reward coin, CONTINUE 440 × 200 + RETRY 460 × 200 (orange with the highlight; Figma's rewarded x2 offer is not Core's), centred on 540 (docs/figma/theme-light-6); FAIL Figma `screen/result-fail` 1:4029: grey ribbon, glow band, broken heart + runtime `-1` + outcome line, TRY AGAIN + optional EXIT (the RETURN HOME art, no Figma node); the hero art is game content, not drawn (docs/figma/style1-result) | covered — WIN theme_light_6 28:48352: the red ribbon, the rays, `icon_star` stars, the coin + #943300-outlined amount, CONTINUE on `btn_green` + the secondary on the bare `btn_yellow`, the popups' red × (no × in Figma); FAIL derived from Style 2's parts (no Figma FAIL) (docs/figma/theme-light-6) |
| MovesView | covered — theme_light_6 28:48247: the white box, "MOVES" + the #ffc300 count with the kit outline | covered — theme_light_6 28:48175: the blue box, white Carlito "MOVES" + count |
| SettingsButtonView | covered — theme_light_6 28:48211: blue `btn` 214 + the outlined gear 10 above the centre, 90 / 90 | covered — theme_light_6 28:48119: `btn_blue` 214 + `icon_settings`, 90 / 90 |
| NoAdsWindowView | covered — theme_light_6 28:48065: purple promo window, round red ×, rays, dark hero, Fira titles (line 1 pink) | covered — theme_light_6 28:48041: the same window and rays, the red ×, the light hero, Carlito titles with the red outline |
| ShopScreen (the SHOP tab) | covered — theme_light_6 `market_screen_dark` 28:46015: the purple gradient + bears, the dark awning, the stretched dark tape, the dark cards and pack art, the round × (docs/figma/theme-light-6-shop) | covered — theme_light_6 `market_screen_light` 28:46095: #0f172c, the light awning, the blue tape, the blue / white cards and pack art, the popups' red × (docs/figma/theme-light-6-shop) |
| Shop (modal ShopWindowView), StarterPack | not covered — donor look (the styled shop is the ShopScreen tab) | not covered — donor look |

- The catalog is `READY_UI_SKINS` (by id); there is no runtime registration — a new style is a new
  package under `src/pixi/skins/` with its own files. `READY_UI_SKIN_VIEW_ROLES` lists the roles each
  view can draw; `READY_UI_SKIN_WINDOW_ROLES` remains the modal-window subset. Confirm / Lives need all of their roles
  (Lives without `buttonHighlight` when its layout has no highlight); for
  Settings and the non-modal views the style's layout says which optional parts exist (no haptic toggle, OFF button
  art, a home icon; no gear, no HARD badge, no glow, its own locked-node art or map background), and
  `requiredSkinRoles(skin, view)` is what it must ship.
- A style may bring its own font (`skin.font`): `loadReadyUiAssets({ skin })` registers it strictly and the style's
  views use it for their runtime text (Style 2: Carlito Bold, the OFL metric twin of Figma's Calibri Bold).
- Behaviour never moves into a style: drag / fling / snap / focus / culling and the level spacing stay in the shared
  view code and `theme.levelMap` (the host's numbers; Style 2's Figma spacing is in
  docs/figma/style2-level-map-screen/README.md).
- A style whose windows draw one role with different art gives a window its own asset under `'<window>:<role>'`
  (`ReadyUiSkinWindowAssetKey`, e.g. Style 2's `'confirm:windowSurface'` = Style 1's violet shell while its Lives /
  Settings popup is `windowSurface`): in that window it wins over the role. A window may also keep the kit's type
  instead of the style's (`windows.confirm.text`), and a Lives text box may carry its own `fill` / `stroke` / `align`.
- Only the chosen style's files load, each strictly, cached as `game-core-ui:skin:<id>:<role>` (one
  role in two styles never collides) and returned under `textures.skins[id]`. The required pack stays
  the 71 textures; without `skin` nothing else is requested and `textures` has no `skins` key.
- A covered view whose style lacks its layout, an asset for one of its roles, caps for a 9-slice
  role or the loaded texture throws, naming what is missing — never a silent donor fallback.
- No style → every view donor (unchanged). Window `variant: 'donor'` forces the donor art. The pre-style
  `variant: 'figma'` keeps working: the theme's style when it covers the window, else Style 1, whose
  textures may still come from `include: CONFIRM_EXIT_FIGMA_TEXTURES / LIVES_FIGMA_TEXTURES`
  (`READY_UI_OPTIONAL_ASSET_FILES` / `READY_UI_NINE_SLICES` are Style 1's values under the old names).
- Layout conventions are the Figma reads, kept as they are: Confirm and Settings boxes are window-local,
  Lives boxes are frame coordinates. Settings `map-a` / `map-b` currently collapse to the one `map`
  layout. Legacy notification, privacy and restore controls are intentionally not represented: the
  current `SettingsWindowView` has no runtime state or callbacks for them, so adding them is a future
  bounded API slice rather than speculative skin behavior. A style changes files, caps, text look, dim and boxes; adding, removing
  or reordering a window's elements is still view code.
- A game shows the subset of a styled window's parts it uses and the style's layout closes up around them (any style,
  no per-game variant). Settings: a hidden toggle (HAPTIC) leaves no slot — the shown toggles take the first slots,
  centred on the full row; HOME / RESTART without its continuation (`onHome` / `onRestart`) leaves no row — the rest
  moves up and the window is shorter (in-level with neither = the `map` layout). Confirm: `illustration: false` leaves
  out the life-lost art, its `-1` and the glow and closes their band (e.g. a restart that costs level progress, not a
  life). Every part shown = the style's layout unchanged; the donor look is untouched (its Confirm art bakes the heart in).

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

The page also hosts the **OfferRuntime demo** (`examples/pixi-showcase/offerDemo.ts`): Trail
Arrow's production ladder and a fake catalog run on a fake server clock that the Pixi ticker
advances (no `Date`, no timers). The welcome offer activates on the first tick and pops once per
session like the donor; the starter icon shows only while an offer is active, with the countdown
under it; the window gets title / price / rewards / timer from the runtime; BUY runs a demo
purchase (a MotionRuntime delay stands in for the payment sheet, then the host grants the coins
and calls `offers.onPurchased`). The OFFER strip above the toolbar jumps the clock — `+12H` ·
`+24H` · `+48H` · `EXPIRE` (to the active offer's end) · `NEXT` (to the next activation) ·
`RESET` — with one explicit `tick()` per press, and its caption shows the chain state. No real
IAP anywhere.

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

```bash
SHOWCASE_URL=http://127.0.0.1:5180/ npm run showcase:offers   # the OfferRuntime chain proof
```

drives the chain end to end at 390 × 844: the welcome window with its data and timer, the timer
following a clock jump and the host ticker, a real BUY tap (BUY disabled while the demo payment
is pending) that moves the chain into the 24 h cooldown and credits the coins, NEXT → tier 2 A,
EXPIRE → tier 1 A → EXPIRE → tier 1 B (the variant flips), and the window closing by itself when
its offer expires; it checks the exact event log and writes `showcase-shots/offer-*.png`.

```bash
SHOWCASE_URL=http://127.0.0.1:5180/ npm run showcase:style2   # the Style 2 LevelMap screen proof
```

`examples/pixi-showcase/style2.html` (`?figma=1` = the Figma frame's sample values as host data) and
`scripts/style2-level-map-check.mjs`: region parity against Figma's render of 8:23174 at 1422 × 800, 1280 × 800 next
to Figma, 390 × 844 and 320 × 568 shots, a slow drag that snaps back, a fling that projects past its release, a held
drag that snaps to the nearest level, culling, real clicks on a completed / a locked level, PLAY, HOME and the locked
nav item, and no Style 2 request from the donor / Style 1 pages. Writes `showcase-shots/style2/`.

```bash
SHOWCASE_URL=http://127.0.0.1:5180/ npm run showcase:style2-settings   # the Style 2 Settings proof
```

`examples/pixi-showcase/settings2.html` (`?figma=1` = the Figma sample copy as host text, `?map=1`, `?locale=ru`,
`?sound=0` / `?music=0`) and `scripts/style2-settings-check.mjs`: region parity against Figma's render of 8:17493 at
1080 × 2344, 390 × 844 next to Figma, EN / RU / OFF / map, 320 × 568 and 1280 × 800 shots, real taps on Sound,
Restart level, Return home and ×, and no Style 2 Settings request from the donor / Style 1 pages. Writes
`showcase-shots/style2-settings/`.

```bash
SHOWCASE_URL=http://127.0.0.1:5180/ npm run showcase:style2-windows   # the Style 2 Confirm + Refill Hearts proof
```

`examples/pixi-showcase/windows2.html` (`?window=restart|exit|refill`, `?figma=1` = the Figma sample copy and values
as host data, `?locale=ru`, `?state=full|noad`) and `scripts/style2-windows-check.mjs`: region parity against Figma's
renders of 8:22049 / 8:22069 / 8:22838 at 1080 × 2344, 390 × 844 next to Figma, EN / RU / full / no-ad, 320 × 568 and
1280 × 800 shots, real taps (RESTART / EXIT run the host's action, × / backdrop dismiss, REFILL / GET report the
params, the countdown ticks), and no Style 2 request from the donor / Style 1 pages. Writes
`showcase-shots/style2-windows/`.

```bash
npm run showcase:style1-result   # the Style 1 Result WIN / FAIL proof
```

`examples/pixi-showcase/result1.html` (`?outcome=win|fail`, `?figma=1` = the Figma sample copy and values as host data,
`?locale=ru`, `?stars=0..3`, `?exit=0`, `?lives=0`, `?confetti=1`, `?donor=1`) and `scripts/style1-result-check.mjs`:
region parity against Figma's renders of 1:3854 / 1:4029 at 1080 × 2344 (sampled with the measured centring offset:
the Result centres its composition, Figma puts game hero art above it), 390 × 844 next to Figma, RU / 1 star / no
EXIT / confetti / donor, 320 × 568 and 1280 × 800 shots, real taps (CONTINUE / RETRY / EXIT continuations, × /
backdrop dismiss), and no Result file request from the donor pages or the other Style 1 windows. Writes
`showcase-shots/style1-result/`.

### Ready UI gallery (both styles on one page)

```bash
npm run showcase -- --host 0.0.0.0 --port 5180              # then open http://127.0.0.1:5180/ui-gallery.html
SHOWCASE_URL=http://127.0.0.1:5180/ npm run showcase:gallery # screenshots of every style × screen × viewport
```

`examples/pixi-showcase/ui-gallery.html` shows every public Ready UI view of one style over that style's map screen —
the same `LevelMapScreen` for both styles (PLAY + SHOP | HOME | LOCK; every callback lands in the status line as
`last: play:12`, `nav:shop`, `selected:9`…): STYLE (Style 1 / Style 2 — a style is the game's one choice, so switching
reloads the page), a screen picker (LevelMap with every slot active, LevelMap with SHOP / LOCK disabled, Settings compact / with language / in level with and without language, Confirm Restart / Restart + OFFER /
Exit, Lives minimal / REFILL + GET / full with the OFFER, Result WIN 3★ / 2★ / 1★ / 0★ / FAIL, Gameplay — Moves + the
settings button, No Ads, the SHOP tab, the legacy modal Shop), EN / RU and Reopen. The status line says whether the style draws the
screen or it is the donor look (the modal Shop). On the map screens SHOP in the navigation (and the HUD coin "+") switches
to the ShopScreen tab and its HOME / × back to the same map (`screen=shop-screen` opens the page on the tab); every
switch lands in the status line (`nav:shop → tab:shop`, `buy:coins_2`, `nav:home → tab:home`). Query: `?style=1|2&screen=<id>&locale=ru&moves=<n>&ui=0` (`ui=0` hides the controls; `moves` = the
gameplay screen's count, default 38). The OFFER's
booster icons (`gallery/*.webp`) are demo game content, not Core. `scripts/ui-gallery-check.mjs` (env `STYLES`,
`SCREENS`, `VIEWPORTS`, `LOCALE`, `MOVES` — default 38,10,1,0) writes `showcase-shots/ui-gallery/<style>-<screen>-<w>x<h>.png`
(the gameplay screen once per moves value, a WIN after its stars landed) and fails on a
console error or a window that never opens. Dev page only: `showcase:build` ships `index.html` alone.

Motion proof on the map screens: PLAY breathes (`playBreathing`), the HUD counters use `resourceFeedback`, a tap on LOCK
shakes it, and the bar's `+250 ¢` / `−120 ¢` / `−1 ♥` / `+1 ♥` buttons change coins and lives with no game logic behind
them. `SHOWCASE_URL=http://127.0.0.1:5180/ npm run showcase:motion` (`scripts/ui-motion-check.mjs`, env `STYLES`,
`VIEWPORTS`) holds the page's clock (`__gallery.hold()` / `step(ms)`) and checks, per style × viewport: the breath
(×1.04, never below the layout scale), a real press on PLAY mid-breath (idle × breath × 0.92, one tap, back to
idle × breath), rapid taps, a coins gain (≤ 12 redraws, pop) and spend (dip), a life spend (heart shake back to rest),
a real LOCK tap (shake ±16, `nav:lock`), repeated hide / show, a `core.cancelAll()` and destroy (nothing left running);
shots in `showcase-shots/ui-motion/`.

ShopScreen proof: `SHOWCASE_URL=http://127.0.0.1:5180/ npm run showcase:shop` (`scripts/shop-screen-check.mjs`, env
`STYLES`, `VIEWPORTS` — default 390x844) drives real clicks on the gallery per style: map → SHOP → a pack (onBuy, the cards
held for the demo payment) → HOME → the same map (focus / selected level unchanged, nothing blocking), map → coin "+" →
× → the same map; shots in `showcase-shots/shop-screen/`.

## Tests

`tests/pixi/` runs the kit headlessly in Vitest (a tiny fake canvas 2D context behind Pixi's
`DOMAdapter`, `Texture.WHITE` for art): public entry and package wiring, level data mapping and
states, selection vs swipe, scroll/focus positioning, resize, `setProgress`, windowed builds,
destroy/listener cleanup, `cancelAll` never firing business callbacks, HUD counters/taps/layout,
window lifecycles and close continuations, the starter-pack timer placement and BUY lock
(`setTimer` / `setBuyEnabled`), and the click ripple (production defaults, a frame-by-
frame check against the donor formula transcribed from `ArrowRenderer.updateOceanRipples`, both
rings ending together, pool reuse, `maxActive = 8` recycling, screen-space sizing under a zoomed
world, global → local coordinates, `configure` validation, pause/resume/cancel through the motion
scope, destroy with no callbacks afterwards). `readyUiOverlay.test.ts` covers the overlay host on a
fake DOM + fake Application with the real Pixi `Ticker` / `EventBoundary`: mount and layering, no
animation frame ever requested, `update()` order and deltas, resize / DPR / safe area, add / remove,
the three input modes, the `UiRuntime` modal sync, dispose, a failed load, the entry boundary.

## Assets (provenance)

Extracted from Trail Arrow (`trail_arrow/public/assets/**` and its texture atlases) into
`assets/pixi-ui/` (69 files, ~1.3 MB): level badges/stars/lock/pill (`level/`), the level-select
background and top shadow (`bg/`), the Figma top bar (`hud/`), buttons (`button/`), icons
(`icons/`), the victory ribbon and purple panels (`window/`), shop awning/cards/coins (`shop/`),
settings panel/toggles/buttons (`settings/`), the no-ads and starter-pack panels, heroes, icons
and the bulb (`offer/`), and Fira Sans Black. No runtime dependency on `trail_arrow/` remains.

Style 2 (`style2/`, ~870 KB, loaded only with `skin: READY_UI_STYLE_2`) is Figma's own transparent renders of the
static leaf visuals of `theme_light_3` 8:23174 plus the raw sky image, the Settings art of 8:17493 (`settings_*`),
the Refill Hearts leaves of 8:22838 (`button_primary`, `button_rewarded`, `lives_glow`, `icon_tv`, `price_coin`),
and `fonts/Carlito-Bold.woff` (OFL 1.1, `fonts/Carlito-OFL.txt`); provenance and commands in
docs/figma/style2-level-map-screen/README.md, docs/figma/style2-settings/README.md and
docs/figma/style2-refill-hearts/README.md. Style 2's Confirm ships no file of its own: it draws Style 1's
(docs/figma/style2-confirm/README.md).

theme_light_5 PLAY and navigation (docs/figma/theme-light-5-level-map-nav/README.md): Style 1's `button/style1_play.webp`
and `nav/style1_*.webp` (~110 KB, loaded only with `skin: READY_UI_STYLE_1`) and Style 2's `style2/nav_lock.webp` —
Figma's own renders.
