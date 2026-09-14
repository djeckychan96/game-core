# Game Core Architecture

## Scope

Game Core is a reusable runtime library for shared HTML5 game systems. Version 0.1 contains only the FX runtime surface:

- effect lifecycle
- pooled node acquisition and release
- trajectories and easing
- impact and completion callbacks
- cleanup and diagnostics

The host owns rendering, asset loading, DOM, canvases, application objects, and tickers.

## FX Runtime

`FxRuntime` updates all active effects through one host-driven call:

```ts
const changed = fxRuntime.update(frameMs);
```

`true` means a visible FX state changed and the host can render its own FX surface. `false` means nothing changed. The runtime never starts `requestAnimationFrame`, never creates a rendering application, and never calls render.

## Surface Boundary

The runtime targets `FxSurface` and opaque `FxNode` objects. It only needs:

- `attach`
- `detach`
- `setPosition`
- `setScale`
- `setRotation`
- `setAlpha`
- `setVisible`

The Pixi adapter uses a small duck-typed display object subset compatible with PixiJS 7 and PixiJS 8. The production bundle does not include PixiJS.

## Pooling

`FxPool` is fully configurable by the host:

- `createNode`
- `prewarm`
- `maxSize`

Release detaches the node and resets visibility, alpha, transform, and position. Nodes are reused instead of destroyed during normal effect sequences when prewarmed capacity is sufficient.

## Effects

Version 0.1 includes two generic primitives:

- `projectile`: quadratic Bezier movement with delay, scale/alpha keyframes, optional trajectory rotation, impact callback, and completion callback.
- `radialBurst`: pooled radial particles with configurable start radius, travel distance, jitter, scale, alpha, duration, and scope.

## Diagnostics

`FxRuntime.getStats()` reports:

- active effects
- pool acquires
- pool releases
- pool misses
- created nodes
- dropped effects
- last update time
- max update time

Stats can be reset through `resetStats()`.
