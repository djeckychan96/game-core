# Game Core localization

`LocalizationRuntime` is the renderer-independent localization seam for Game Core and host games.
It resolves one locale during boot and keeps it for the lifetime of the runtime. It has no Pixi,
DOM, browser-global, storage or platform dependency.

## Production boot order

The platform is the only production source of the raw locale:

```ts
import { LocalizationRuntime, mergeLocalizationCatalogs } from 'game-core';
import { READY_UI_CATALOGS } from 'game-core/pixi';

await platform.ready();

const gameCatalogs = {
  en: { 'game.play': 'PLAY' },
  ru: { 'game.play': 'ИГРАТЬ' }
} as const;

const i18n = new LocalizationRuntime({
  rawLocale: platform.environment.language(),
  supportedLocales: ['en', 'ru'],
  defaultLocale: 'en',
  fallbackLocale: 'en',
  catalogs: mergeLocalizationCatalogs(READY_UI_CATALOGS, gameCatalogs)
});
```

The invariant is:

```text
await platform.ready()
→ platform.environment.language()
→ LocalizationRuntime
→ Ready UI / game UI
```

Do not add a `navigator.language`, DOM or user-agent fallback to this path. If the platform returns
no locale, the runtime deterministically uses `defaultLocale`.

The showcase's `?locale=ru|en` is only a manual-QA input. It is not a production locale source and
does not implement a live language switch.

## Locale resolution

`resolveSupportedLocale(rawLocale, supportedLocales, defaultLocale)`:

1. normalizes case and `_` / `-` separators (`ru_RU` → `ru-RU`, `EN-us` → `en-US`);
2. selects an exact supported locale when present;
3. otherwise tries its base language (`ru-RU` → `ru`);
4. otherwise selects `defaultLocale`.

The returned locale uses the spelling configured by the host in `supportedLocales`. An empty
supported list, an invalid locale, duplicate normalized locales, or a default/fallback locale not
present in the supported list is a configuration error.

## Translation behavior

```ts
i18n.t('core.result.level', { level: 12 });
i18n.t('game.play');
```

For each key, the runtime reads the selected locale, then `fallbackLocale`, then returns the key
itself. Missing interpolation values stay visible as `{name}`. Ordinary content gaps do not crash
the game; the optional `onDiagnostic` callback reports a deduplicated `fallback_key`, `missing_key`
or `missing_param` event. Exceptions thrown by diagnostics are contained.

The runtime snapshots and freezes the supplied catalogs. Its locale and configuration cannot be
changed after construction; create a new runtime during a new boot if the host needs another
locale.

## Catalog composition and validation

Core keys use `core.*`; host-game keys use `game.*`. Combine both namespaces into the one runtime
with `mergeLocalizationCatalogs(READY_UI_CATALOGS, gameCatalogs)`. Duplicate keys for the same
locale throw instead of silently overriding one owner.

All built-in RU/EN Ready UI copy and exact pre-localization fallbacks live only in:

- `src/pixi/locales/en.ts`
- `src/pixi/locales/ru.ts`
- `src/pixi/locales/legacy.ts`

`validateLocalizationCatalogs(catalogs, options)` reports missing/unknown catalogs, invalid values,
key-parity gaps and interpolation-placeholder mismatches. This is intended for tests and content
pipelines. `LocalizationRuntime` rejects structural configuration errors at construction while
retaining safe runtime fallback for ordinary missing keys.

## Ready UI contract

Ready UI views accept an optional renderer-agnostic `LocalizationTextProvider` as `i18n`. Text
selection is always:

```text
explicit View option / show param → i18n key → exact legacy default
```

This keeps existing games unchanged when they pass no provider. Explicit host copy remains
authoritative. `UiButton` only receives final display text and never knows localization keys.

Localization and UI Skin V1 are orthogonal choices: the host chooses one skin and one locale; a
locale never chooses or mutates a skin. Current provider coverage includes Confirm, Lives,
Settings, Result, HUD, LevelMap, Shop, NoAds, StarterPack and OrientationGuard.

## Deferred slices

Localization V1 keeps the existing label-fit behavior. A general wrap/shrink policy, minimum font
sizes, overflow diagnostics and the wider viewport matrix remain a separate text-fit slice. Font
coverage and asset work (including the known U+2009, `€` and `∞` gaps) also remain a separate slice;
this change does not rebuild or replace the font.

## Showcase proof

```bash
npm run showcase:localization
```

The check uses system Chrome at 390 × 844 for EN/RU Style 1, captures Confirm, Lives, Settings
map/gameplay, map/HUD and Result, drives real callbacks, checks visible text bounds, confirms that
the locale does not change the skin, and runs a donor/no-provider compatibility smoke. Screenshots
are written to `showcase-shots/localization/`.
