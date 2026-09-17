# Platform Layer v0.8 — design (slice A: contract + DEV)

Branch `feat/platform-runtime-v0.8` (from `feat/ads-runtime-v0.7` @ 91b237d). Not merged, no tag, no push.
Source of truth: the read-only production audit "PLATFORM LAYER v0.8 — PRODUCTION AUDIT" of 2026-09-17 (Trail Arrow 0.1.22 @ 628bf6f: `platform/{yandex,cleverapps,localhost}/systems/HttpRequestSystem.ts`). Its §5 (capabilities), §6 (ads), §7 (payments / catalog), §8 (analytics), §9 (config) and §11 (explicit target) are mirrored below.

## 1. Goal

A stable, capability-based platform contract that the real Yandex and CleverApps adapters plug into in slice B. Core runtimes never learn a concrete SDK. Slice A ships the contract, a small facade, the catalog state, the client-safe config shape, the analytics seam and a complete DEV platform. **No SDK adapter, no connector, no autodetect, no JWT resolver** — see §10.

The donor's platform layer is one 850–900-line file per platform behind a broadcast message bus with no correlation id (three windows filter `ads.rewarded` by placement to not grant somebody else's reward). The contract answers every call with its own Promise.

## 2. Module layout

```
src/platform/
  types.ts            GamePlatform + 7 capabilities, PlatformAdResult, PlatformProduct, PlatformCode
  PlatformRuntime.ts  facade: required-capability check, storage read guard, ready(), capabilities(), catalog
  catalog.ts          PlatformCatalog (live merge state), normalizePlatformProducts
  config.ts           GamePlatformConfig types + validateGamePlatformConfig (refuses secrets / JWT values)
  adapters/dev.ts     createDevPlatform — every capability, no SDK / network / money
  index.ts
src/composition/platformAnalytics.ts   platform → AnalyticsRuntime context (types only)
```

`src/platform` has one import out of the module: `PaymentsAdapter` & co. from `../purchases/types`, **type-only** — the payments capability must BE PurchaseRuntime's adapter, not a rival. No Pixi, DOM, `localStorage`, `Date`, timers, `fetch`, `import.meta`, SDK globals — enforced by `tests/platform/public-api.test.ts` and `scripts/check-pixi-build.mjs`.

## 3. Capabilities

`GamePlatform = { identity, environment, storage, gameplay, ads?, payments?, lifecycle? }`. A missing optional capability means "this platform cannot" (Yandex: no banner, no shortcut; MSN: no payments). Core never substitutes a stub that pretends — `platform.ads` is `undefined` and the host checks.

| capability | contract | notes from production |
|---|---|---|
| `identity` | `ready()`, `playerId(): string \| null`, `displayName()` | `ready` resolves for a guest too (Yandex guest mode); `""` id → null. No social / friends / avatar — production uses none. |
| `environment` | `platformCode()`, `language()`, `deviceType(): … \| null`, `platformOs(): string \| null`, `launchPayload()`, `serverTime(): sec \| null` | null = the platform does not know, the host's UA detection / own clock stands. Only Yandex has `deviceType`, `launchPayload`, `serverTime`. |
| `storage` | `isCloud()`, `ready()`, `get(keys)`, `set(patch): boolean`, `clear(keys)` | see §4. |
| `gameplay` | `reportLoadingProgress(0–100)`, `ready()`, `start()`, `stop()` | YA `LoadingAPI.ready` / `GameplayAPI`; CA `startGame + notifyGameReady` / `gameplayStart/Stop`. |
| `ads?` | `showInterstitial(placement)`, `showRewarded(placement)`, `isRewardedAvailable()`, `showBanner?()`, `hideBanner?()` | see §5. |
| `payments?` | `PaymentsAdapter` + `getCatalog()` | see §6. |
| `lifecycle?` | `canCreateShortcut()`, `createShortcut()` | the only social-ish feature production uses. |

`PlatformCode = 'YA' | 'FB' | 'SAM' | 'MSS' | 'VK' | 'OK' | 'AN' | 'DEV'` — closed on purpose (an explicit target is a compile-time fact) and assignable to `AnalyticsPlatform`.

## 4. Storage invariant

**A read that failed rejects. It is never `{}` / null.** Both production save-loss incidents (S1 on CleverApps, BWJ on Yandex) were a failed cloud read taken for a new player, whose empty profile then overwrote the cloud. The contract states it, the DEV platform follows it (a throwing store or a corrupted value rejects — no try / catch around the read), and `PlatformRuntime` enforces the detectable half for ANY adapter: `storage.get()` answering a non-object becomes a rejection. A key never written is *absent* from the answer.

`set` answers `true` / `false` (CleverApps `storage.set → false`, a throttled Yandex `setData`); a rejection reads as false. The local mirror, the rollback guard, `save_seq`, write throttling (≥ 3 s on Yandex) are NOT here: the first three know the game's model (host), the last is the adapter's.

## 5. Ads contract

`PlatformAdResult = { status, rewarded, placement, raw? }`, `status ∈ shown | rewarded | dismissed | no_fill | timeout | error`. `rewarded` is true exactly when `status === 'rewarded'` and is **the only thing a game grants on**. Both show methods always resolve.

Mapping (adapters, slice B): YA inter `onClose(true)` → `shown`, `onClose(false)` / `onError` / `onOffline` → `no_fill`, watchdog → `timeout`; YA rewarded `onRewarded` + `onClose` → `rewarded`, `onClose` alone → `dismissed`; CA `true` → `shown` / `rewarded`, `false` → `no_fill` / `dismissed`, 90 s → `timeout`.

AdsRuntime v0.7 is untouched and stays the decision: `ads.decide(placement, 'inter')` → `platform.ads.showInterstitial` → `shown` ⇒ `ads.registerShown`; rewarded: decide + `isRewardedAvailable()` → `showRewarded` → `rewarded === true` ⇒ grant + `registerShown`. Core defines the contract and never calls a show method (build check). Timeouts, the ad watchdog, sound pause and gameplay stop / start around the ad are adapter-side.

## 6. Payments and catalog

`PlatformPayments extends PaymentsAdapter` (v0.6, unchanged: `purchase / restore / consume? / restoreGrant?`) and adds only `getCatalog(): Promise<readonly PlatformProduct[]>`; `platform.payments` goes straight into `new PurchaseRuntime({ payments })`. `PlatformProduct = { id, priceText, currency }` — the platform's READY price string. No price amount: the only Core consumer of money, `PurchasePriceResolver`, takes revenue from the host's own table like the donor (`Balance.productPriceAmount`).

`PlatformCatalog` is live state for the donor's three consumers — `OfferRuntime`'s `hasPrice`, shop labels, the currency behind `AdsInput.currencyScale`:
- a product counts when it has an id AND a price string (donor: `if (product.id && product.price)`);
- a late catalog MERGES (donor: `{ ...productPrices, ...late }`); an empty or failed refresh never removes a known price;
- `currency()` = first product of the latest non-empty catalog, `""` before — the host then falls back to its build target (Yandex's `"YAN"` label fallback stays host / adapter-side);
- `refresh()` reads once (concurrent calls share the read); `merge()` is the push path for a polling adapter. **No schedule in Core**: Yandex 15 / 45 / 120 s retries and the CleverApps 250 ms / 5 s polling are adapter / host orchestration.

How currency maps to `currencyScale` (the donor: `1/85` by BUILD MODE) is a host decision — not changed here.

## 7. PlatformRuntime

A facade, not an orchestrator: checks the required capabilities and their methods at construction (fail fast, also for JS hosts), rejects an unknown platform code, exposes the capabilities as given (only `storage` is wrapped, for the read guard), `ready()` = `identity.ready()` then `storage.ready()` (a failure is not remembered), `has()`, `capabilities()`, `catalog`. No SDK detection, no fallbacks.

## 8. DEV platform

`createDevPlatform(options)` closes the audit's DEV hole (the donor's localhost never answers `app.ready`, `gameplay.on/off`, `user.reset`, `check.consummations`, so restore was untestable locally):
- identity: a guest (`null`) by default like the donor's localhost, `playerId` option;
- storage: JSON per key over an injected Web-Storage-shaped `store` (a browser host passes `localStorage`; default in memory) — Core itself never names the global;
- ads: `shown` / `rewarded` by default, every status scriptable (`adOutcome`), statuses kept honest per ad type, a `no_fill` rewarded latches `isRewardedAvailable()` false (the donor's Yandex behavior, so the "hide the button" path is testable);
- payments: receipts HELD until `consume`, `restore()` lists them, outcomes `ok | lost | cancelled | error` (`lost` = paid but the game is told `cancelled` — the restore scenario), `dev.addReceipt()` for a previous-session purchase, `restoreGrant` option for both policies. Tokens `dev:<n>` with the counter persisted in `store`, so a reload never collides with a persisted granted registry (`createToken` overrides);
- `dev.getState()` (appReady, gameplayActive, loadingProgress, banner, counters), `dev.reset()`; capabilities can be switched off (`ads: false`, `banner: false`, `payments: false`) to rehearse a poorer platform.
No timers: everything resolves immediately. No `Date`, no `Math.random`.

## 9. Config shape and analytics seam

`GamePlatformConfig = { app, platforms: { [code]: { provider, platformCode, analytics?: { endpoint, jwtRef }, connector?: { projectId, source?, clientConfig? }, publicIds? } } }`. Everything in it ships in the client bundle, so: no field for a secret in the types, `jwtRef` is the NAME of the build-env entry (never the token), and `validateGamePlatformConfig` refuses keys matching secret / privateKey / serviceKey / publicKey (production's `msstart.publicKey` is server-side) / password / jwt / token / apiKey anywhere in the object, and any string shaped like a JWT. Types and validator only — no resolver, no env reading (slice B+, blocked on the audit's open questions: `studioId`, the exact connector script line, the real `jwtRef` set).

`createPlatformAnalyticsContext(platform, host)` builds an `AnalyticsRuntime` context provider: the platform gives `p` (always the explicit target — the "FB build reporting under YA" bug class has no host line left), `playerId`, its device knowledge, `language`; the host keeps `app`, versions, `installedAt`, the `platformOs` fallback, A/B, `baseData`, the JWT — **and the profile-id policy**: the late guest → player id switch doubled players in production (17.08), so the seam hands `playerId` to the host callback instead of writing `profileId` itself. AnalyticsRuntime is unchanged.

## 10. Explicit target, and what is NOT in slice A

Production = explicit build target: the host constructs the platform for its build (`provider` + `platformCode` from config). Autodetect may appear later for DEV / universal stands only; reading `connector.info.source` as a *verification* of the explicit target is a later idea too.

Out of scope, next slice (v0.8-B): YandexAdapter, CleverAppsAdapter (+ FB / Samsung reach-throughs), `withTimeout` / ad watchdog support, connector.latest.js integration, VK / OK native SDKs, SDK autodetect, the Hazar JWT value resolver, build plugin / env generation, the Trail Arrow integration.

## 11. Verification

`npm test` (`tests/platform/`, 26 tests), `npx tsc --noEmit`, `npm run build` (the build check now also requires the platform exports in the root bundle, keeps them out of the kit, forbids SDK globals / `localStorage` in the root bundle; the v0.7 ad guard was narrowed from the *name* `showInterstitial` — now Core's own contract name — to *calls* of any show method), `npm run smoke:platform` — a DEV-only end-to-end run on the built public entry, no browser.
