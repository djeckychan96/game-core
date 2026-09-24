# Platform Layer v0.8-B1 — production Yandex platform adapter

Branch `feat/platform-yandex-v0.8-b1` (from `feat/platform-runtime-v0.8` @ 89fb48e). Not merged, no tag, no push.
Donor: Trail Arrow 0.1.22 @ 628bf6f, `platform/yandex/systems/HttpRequestSystem.ts` (900 lines). Contract: the v0.8-A spec. Audit: "PLATFORM LAYER v0.8 — PRODUCTION AUDIT" §3, §6, §7.

## 1. Goal and the architectural decision

Port the real production Yandex integration 1:1 onto the v0.8-A capabilities. **Donor semantics are not improved.**

**Platform SDK adapters never enter the root bundle.** The adapter is a separate public entry, built like `game-core/pixi`:

```
game-core                    root: contract, PlatformRuntime, PlatformCatalog, DEV platform — NO SDK name
game-core/platform/yandex    YandexPlatform — the only bundle that names YaGames
```

```
src/platform/adapters/yandex/   index.ts, YandexPlatform.ts, sdk.ts (structural SDK types + the production boot)
src/platform/support/           withTimeout.ts (withTimeout / sleep / settleWithin + PlatformTimers), adWatchdog.ts
vite.platform-yandex.config.ts  → dist/platform/yandex/game-core-platform-yandex.es.js (+ a d.ts tree)
scripts/check-platform-build.mjs
```

The adapter imports the root as **types only** (the capability contract, `PaymentsAdapter`), so its bundle is self-contained (17 kB) and duplicates no root runtime. The root guard of `check-pixi-build.mjs` is untouched; `check-platform-build.mjs` ADDS: no `YaGames` / `showFullscreenAdv` / `getPayments` / `YandexPlatform` / `sdk_timeout` … in the root es + iife bundles and the kit; no root runtime, renderer, other platform or `localStorage` in the Yandex bundle; its export list is exact. `src/platform/support/` belongs to adapter entries — the root never imports it (pinned by `tests/platform/public-api.test.ts`).

`YaGames` is named in ONE source file (`sdk.ts`); tests and stands inject `init`.

## 2. Capabilities

`identity / environment / storage / gameplay / ads / payments`. **No `lifecycle`** (production Yandex has no shortcut) and **no banner** (`showBanner` / `hideBanner` absent). `payments` is always present: PlatformRuntime snapshots capabilities before the SDK is up, and "payments are off" is a production state, not a missing capability (§6).

## 3. Boot, identity, environment — retained 1:1

- `ensureSdkReady` behind EVERY call: `YaGames.init()` under **20 s**; one retry after a failure / timeout (`sdk_init_retry`); after a total failure **30 s of "SDK is dead"** — calls answer at once with `sdk_dead_cooldown` instead of re-running 2 × 20 s; then one honest attempt. Concurrent callers share one init.
- Script: the donor's page-loader contract — the global is there, or `globalThis.__SDK_READY__` (the `<script onload>` promise of index.html), or `sdk_script_missing`. Not under the 20 s (the loader has its own 3 retries). Skipped when `init` is injected.
- **The player never blocks the entry**: `getPlayer({ scopes: false })` (10 s) starts in parallel with init's tail — `scopes: false` is SoliPix production (no personal-data permission dialog) and the default since v0.9.1; the boot call and every retry share one request object, `playerScopes: true` is the opt-in for a game that shows the name / avatar (the Trail Arrow donor passed no options). Failure / hang = **guest mode** (`guest_mode`) + the background retry **5 × every 15 s** (`guest_recovered`). `identity.ready()` = the SDK is up, not "the player is known".
- `playerId()` = `getUniqueID()`, `""` → null. `displayName()` = `getName()` **untrimmed** — the donor's 9-character cut is Trail Arrow HUD cosmetics.
- `onPlayer(id)` tells the host when the player object arrives (boot or retry). The donor's `onSdkIdArrived` / `identity_link` (the 17.08 doubling fix) is the host's policy.
- `getPayments({ signed: false })` under **8 s**; failure → `null` = payments off, a normal path (a hung one used to hold the whole init).
- environment, read live: `platformCode` `YA`; `language` = `environment.i18n.lang`; `deviceType` = `deviceInfo.type` if mobile / tablet / desktop else null; `launchPayload` = `String(environment.payload).slice(0, 200)`; `serverTime` = `floor(serverTime() / 1000)`, null without it; `platformOs` null (host UA).

## 4. Storage — retained 1:1, and what stays in the host

- `get(keys)`: waits ≤ **3 s** for a player still on its way (the donor's `user.get` window); `getData(keys)` under **8 s**, **3 attempts**, pauses 1 s / 3 s; **a total failure REJECTS**. A non-object answer rejects.
- **A guest REJECTS with `YANDEX_NO_PLAYER`** — never `{}`. The donor answers a guest with its local MIRROR; the mirror is host-side now, and an empty answer would read as "new player" and overwrite the cloud when the player arrives. The host catches this one message → plays from its mirror and guards its first write.
- `set(patch)`: `setData(patch, true)` under **10 s**; **serialized + throttled**: at most one write in flight, real writes ≥ **3 s** apart (production: 238 `sdk_timeout:setData` at 12 of 13 players). A call made while one is in flight is merged (later key wins) and ~~answered true at once, like the donor's `ok`~~ — **since 2026-09-24 (honest ACK)** answered by the `setData` turn that carries its patch: every call gets a sequence number, a turn carries every call queued before it took the patch, its success answers them `true`; its failure — or the chain stopping on an earlier failure — answers `false` (the patch stays queued for the next write; that answer never turns `true`). `clear` the same, rejecting instead of `false`. Failure / timeout → `false` + `cloud_save_failed`. A guest → `false`.
  - One adaptation, forced by the patch API: the donor re-reads the WHOLE model on every turn, so its retry loses nothing. Here the unwritten patch is **carried into the next write**; `clear(keys)` drops carried keys. Observable behavior is the donor's ("nothing is lost").
- `clear(keys)`: the donor's `user.reset` — `setData({ key: null }, true)` under 10 s, outside the throttle; a guest rejects.
- NOT ported, host-side by the audit: the local mirror, the "old cloud" rollback guard, `save_seq`, `adoptCloudIdentity` / the identity snapshot, the guest-conflict guard (`guestStarted` / `cloudChecked` / `cloudWriteBlocked`, incl. "a blocked guest does not buy"), the `profile === ""` reading.

## 5. Gameplay and ads — retained 1:1

- `gameplay.ready()`: once; `LoadingAPI.ready()` **and immediately `GameplayAPI.start()`** — until the first start the Yandex webview keeps a low-fps mode (the menu lagged). `startGameplayOnReady: false` opts out. `start()` / `stop()` record the state the GAME asked for; `reportLoadingProgress` is a no-op.
- Around every show, in the donor's order: `setAdShowing(true)` → `pauseAudio()` **before** the SDK call (its `onOpen` is late or never comes; called again on `onOpen`) → remember `gameplayActive` → `GameplayAPI.stop()` → the show → **finally**: `setAdShowing(false)` → `resumeAudio()` → `GameplayAPI.start()` **only if gameplay ran before** (donor bug 08.09: an inter on level exit switched gameplay on in the menu). `finally` also covers a synchronous SDK throw (donor: a missed resume = a game without sound). The donor's `AdsShowingComponent` + `resize` dispatch and `app.sound` are the hooks; a throwing hook is contained (`hook_threw`).
- Watchdog (`createAdWatchdog`): page visible again + **2 s** of SDK silence, or **120 s** hard → the adapter closes the show. First `done` wins.

| SDK | `status` | `rewarded` |
|---|---|---|
| inter `onClose(true)` | `shown` | false |
| inter `onClose(false)` / `onError` / `onOffline` | `no_fill` | false |
| rewarded `onRewarded` … `onClose` | `rewarded` — answered at **onClose**, never at onRewarded | **true** |
| rewarded `onClose(true / undefined)` without onRewarded | `dismissed` | false |
| rewarded `onClose(false)` | `no_fill` (`rewarded` if onRewarded came first) + latch off | per onRewarded |
| rewarded `onError` | `no_fill` + latch off — **even after onRewarded** (donor) | false |
| watchdog | `timeout`; a rewarded whose onRewarded was recorded → `rewarded` | per onRewarded |
| synchronous SDK throw / dead SDK | `error` | false |

`isRewardedAvailable()`: the SDK has none → true until a rewarded `onError` / `onClose(false)`, then false for the session (donor latch, never reset). **No `registerShown` in the adapter** — the host does it after a confirmed show.

## 6. Payments and catalog — retained 1:1

`PlatformPayments` = PurchaseRuntime's `PaymentsAdapter`, `restoreGrant: 'after-consume'`.
- `purchase(id)`: payments off → `cancelled`; `payments.purchase({ id })` under **120 s**, a rejection / hang → `cancelled`; ok needs `purchaseToken` AND `productID` → `{ status: 'ok', productId ← productID, token ← purchaseToken, raw ← the SDK object }`; a dead SDK → `error`. The donor's handler also marks the token and consumes — that is PurchaseRuntime's pipeline now (same order).
- `restore()`: `getPurchases()` under **8 s**; **a failed list reads as `[]`** (donor, `get_purchases_failed`); a dead SDK rejects → `restore_failed` → the host's retries. `consume(p)`: `consumePurchase(token)` under **8 s**, a failure rejects.
- `getCatalog()`: under **10 s** → `PlatformProduct { id, priceText ← price, currency ← priceCurrencyCode ?? '' }`, only `id && price`; empty → `catalog_empty`; payments off → `[]`; a failed read rejects → `PlatformCatalog` `error` (known prices survive). No price is made up; the `"YAN"` label fallback, the 15 / 45 / 120 s catalog retries and the 3 / 15 / 45 s restore waves are host orchestration.

## 7. Known gaps / donor issues kept on purpose

1. `onError` after `onRewarded` answers no reward (donor).
2. A failed `getPurchases` reads as "nothing held" (donor) — reported through `onDiagnostic`.
3. Payments that failed at boot stay off for the session (donor: re-acquired only by a new init).
4. A caller arriving between `init()` and `getPayments()` sees payments off (donor race).
5. The visibility watchdog answers `timeout` for an interstitial that really played before the player left (donor: `no-ad`).
6. ~~A write answered `true` while another is in flight can still fail with the final turn — the donor's own trade-off against retry spam.~~ Fixed 2026-09-24: `true` = a confirmed `setData` carried the patch (tests/platform/yandex/storage-ack.test.ts). The throttle and the collapsing stay; only the answer waits.
7. Not in this slice: CleverApps / VK / OK / FB / Samsung, the JWT resolver, autodetect, the Trail Arrow migration (host-side mirror / guards / hooks wiring).

## 8. Verification

`npm test` (`tests/platform/yandex/`, 27 tests on a fake SDK + fake timers), `npx tsc --noEmit`, `npm run build` (three bundles + both checks), `npm run smoke:platform-yandex` — PlatformRuntime → YandexPlatform(fake SDK) → AdsRuntime → PurchaseRuntime → PlatformCatalog on the BUILT entries, Node only.
