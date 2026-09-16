# Agent Notes

- Keep this library reusable. Runtime source must not contain host-specific gameplay concepts.
- Two layers, two entries. The root entry (`src/index.ts` → `game-core`) is renderer-agnostic: never import or bundle renderer packages into it. The Pixi Ready UI kit (`src/pixi/` → `game-core/pixi`) may import `pixi.js`, but only as an external optional peer dependency (never bundled), and it may import the root entry as **types only** — the host passes its `UiRuntime`/`MotionRuntime` instances in. `scripts/check-pixi-build.mjs` enforces this after every build.
- Do not create rendering applications, DOM nodes for particles, timers, tickers, or `requestAnimationFrame` — in either layer. Kit views animate only through `MotionRuntime` and settle taps only through `ButtonController`/`WindowController`.
- Host integrations provide surfaces, nodes, textures, asset loading, render calls, and frame timing.
- Root modules that reason about wall time (`OfferRuntime`) take the clock injected (`input.now()`, unix seconds from the host's server-anchored time); never read `Date` or `performance` inside `src/`. `frameMs` only paces work. `src/offers/` is a 1:1 port of Trail Arrow's `OfferChain.ts` — change its semantics only with a spec update; the kit (`src/pixi/`) never imports it.
- Use TypeScript strict mode and preserve the public `FxSurface` boundary.
- Add or update Vitest coverage before changing runtime behavior. Kit tests run headlessly through `tests/pixi/setup.ts`; visual checks go through the showcase (`npm run showcase`) with Playwright on the installed Chrome (`npm run showcase:shots`), never the sandboxed in-app browser (no WebGL).
- Ready UI art lives in `assets/pixi-ui/` (extracted from Trail Arrow). Never read assets from `../trail_arrow/` at runtime; never copy anything from `reference-vlad-bubbles/`.
