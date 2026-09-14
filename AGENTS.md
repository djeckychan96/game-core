# Agent Notes

- Keep this library reusable. Runtime source must not contain host-specific gameplay concepts.
- Do not import or bundle renderer packages into production output.
- Do not create rendering applications, DOM nodes for particles, timers, tickers, or `requestAnimationFrame`.
- Host integrations provide surfaces, nodes, textures, asset loading, render calls, and frame timing.
- Use TypeScript strict mode and preserve the public `FxSurface` boundary.
- Add or update Vitest coverage before changing runtime behavior.
