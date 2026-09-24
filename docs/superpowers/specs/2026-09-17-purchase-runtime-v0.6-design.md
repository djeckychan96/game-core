# PurchaseRuntime v0.6 — design

Branch `feat/purchase-runtime-v0.6` (from `feat/analytics-runtime-v0.5`). Not merged, no tag, no push.

## 1. Goal

Move Trail Arrow's production purchase pipeline into a renderer- and platform-independent root module. Two rules:

1. **Never grant before the platform's success answer.**
2. **One real payment is granted exactly once** — after a restore, a reload, a retry, a repeated answer.

`PurchaseRuntime` knows no Yandex / Facebook / Samsung SDK, no storage, no DOM, no clock, and schedules nothing.

## 2. Sources (read only, `trail_arrow-latest` 0.1.22)

| Donor | What it answers |
| --- | --- |
| `src/systems/DataUpdateSystem.ts` `onShopPurchase` | grant by `productId`, `markPayer`, `recordPayment`, the single `trackPurchase` point for direct AND restored purchases, `user.save` after every grant, restore waves 3 s / 15 s / 45 s after any non-ok answer, "paid product has no reward mapping" |
| same, `onCheckConsummations` | restored purchases re-enter `onShopPurchase`; old answers with `productIds` only (no tokens); 2 retries 7 s / 14 s when the list failed |
| `platform/yandex/…/HttpRequestSystem.ts` | `purchase` 2 min timeout → cancelled; needs `purchaseToken && productID`; `markGranted(token)` **before** `consumePurchase` (8 s, failure swallowed); restore: consume one by one, grant only consumed and unseen, a failed consume keeps the receipt |
| `platform/cleverapps/…/HttpRequestSystem.ts` | empty answer = cancel; token = `paymentId ?? purchaseToken ?? productId:purchaseTime`; restore marks **before** consume and ignores its failure; no token → granted without marking + `restore_no_payment_id`; `consummationsInFlight` guard |
| both | registry `hazargames.arrow.iap.granted_tokens`: JSON list, `includes` → skip, `slice(-50)`, any storage error → live without the registry |

## 3. Module layout

```
src/purchases/
  types.ts            PaymentsAdapter, PlatformPurchase(Result), GrantedPurchaseStore, events, results, stats
  PurchaseRuntime.ts  purchase / restore / getPending / isPayer / getStats / dispose
  grantedStore.ts     createGrantedPurchaseStore (memory, cap 50, onChange)
  index.ts
src/composition/purchaseAnalytics.ts   PurchaseRuntime events → AnalyticsRuntime (types only on both sides)
```

`src/purchases` imports nothing outside itself — not `OfferRuntime`, not `AnalyticsRuntime`, not even as types.

## 4. Platform contract

```ts
interface PlatformPurchase { productId?: string; token?: string; raw?: unknown }
interface PlatformPurchaseResult extends PlatformPurchase { status: 'ok' | 'cancelled' | 'error'; error?: unknown }
interface PaymentsAdapter {
  purchase(productId: string): Promise<PlatformPurchaseResult | null | undefined>;   // empty = cancelled
  restore(): Promise<readonly PlatformPurchase[] | null | undefined>;
  consume?(purchase: PlatformPurchase): Promise<unknown>;                            // resolved = consumed
  readonly restoreGrant?: 'after-consume' | 'before-consume';
}
```

The adapter owns SDK readiness, availability, **timeouts** and the mapping (`token`: Yandex `purchaseToken`, CleverApps `paymentId ?? …`; `raw`: the SDK object CleverApps' `consume` needs). `consume` receives the whole purchase, not a bare token, because of that.

## 5. Pipeline

### 5.1 Exact donor ordering (parity review, 2026-09-17)

In the donor the platform handler marks and consumes, and only its answer makes the game grant (`DataUpdateSystem.onShopPurchase`) — so **the grant is last on every path**.

| Path | Donor code | Order |
| --- | --- | --- |
| Direct, Yandex | `platform/yandex/…/HttpRequestSystem.ts:555-574` | `purchase()` ok with `purchaseToken && productID` → `markGranted(token)` → `consumePurchase` (8 s, failure swallowed) → answer ok → **grant** → `user.save` |
| Direct, CleverApps | `platform/cleverapps/…/HttpRequestSystem.ts:644-668` | `purchase()` ok → `markGranted(paymentId)` if there is one → `consume(purchase)` (8 s, failure swallowed) → answer ok → **grant** → `user.save` |
| Restore, Yandex | same file `:599-623` | per receipt: `alreadyGranted`? → `consumePurchase` (a failure keeps the receipt: no mark, no grant) → if not granted before: `markGranted` → listed in the answer; after the loop the game **grants** each listed one |
| Restore, CleverApps | same file `:510-542` | per receipt: `already`? → `markGranted(token)` if new and keyed → `consume` (failure ignored) → if new: listed in the answer; after the loop the game **grants** each listed one; no key → granted unmarked + `restore_no_payment_id` |

`PurchaseRuntime` follows exactly this: `claim` (= "already granted?" + mark, one synchronous block) → `consume` → `deliver` (= `resolveGrant` + `grant` + `granted` event) for a direct purchase and for `before-consume`; known? → `consume` → `claim` → `deliver` for `after-consume`; a restore pass delivers after all its consumes. An earlier revision of this branch granted before the mark and the consume; that was reverted — this slice does not change financial behavior.

Consequences that come with the donor order (kept, not "fixed"): a paid product without a reward mapping, or a `grant` that throws, is already marked and consumed when it fails — it is reported (`no_grant` / `grant_threw`, donor: `console.warn("[IAP] paid product has no reward mapping")`) and never retried; a tab closed during the consume await loses that grant.

### 5.2 Direct purchase

`started` → adapter → (`cancelled` | `error`) or ok → payer → product id → claim → consume → deliver → result.

- A known token on a direct purchase is `duplicate`: consumed, not granted. The donor has no check on this path (its `markGranted` no-ops and the game grants); kept because the brief requires "a processed token never grants again" (an owned product, a replayed answer).
- The claim re-checks the registry live (the donor reads a snapshot once per restore pass), so a restore racing a direct purchase of the same receipt grants once whichever continuation runs first.
- The grant follows the product the platform reports; `requestedProductId` is carried in the context, the event and the analytics.
- ok without a product id → `error: no_product_id`, nothing marked or consumed (Yandex answers `cancelled` for it; CleverApps falls back to the requested id in its adapter).
- No token → granted, not marked (CleverApps semantics); the Yandex adapter answers `cancelled` without a token, as today.
- A second `purchase()` while one is in flight → `busy`, the adapter is not called (the donor guards this in each window).
- Adapter rejection / sync throw → `error: adapter_threw`. Never rejects.
- `restoreAdvised` = cancelled | platform / adapter error | `no_product_id`: the payment may have gone through — the host runs its waves. False after a failed grant (the token is marked, a restore would not grant it).

### 5.3 Restore

One pass, `busy` while one runs. Per purchase: no product id → `error: no_product_id`, left on the platform (the donor consumes such a receipt without granting; this junk-input edge was left as is); known token → `duplicate`, consume only; otherwise by `PaymentsAdapter.restoreGrant` — `after-consume` (Yandex; the default when the adapter has `consume`) or `before-consume` (CleverApps; also what an adapter without `consume` gets), in the orders of §5.1. Grants run after the pass. Adapter rejection → `status: 'error'` + `restore_failed`; the host retries.

### 5.4 Dispose

New calls → `disposed`; a platform answer arriving later is not acted on (no mark, consume, grant — the next runtime's `restore()` picks it up). A purchase that was already claimed when `dispose()` arrived is carried through to its grant — it is marked, nothing would ever grant it again.

## 6. Composition

`createPurchaseAnalyticsHandler(analytics, price, next)`: `purchase_started`, `purchase_ok`, `purchase_restored`, `purchase_cancelled`, `purchase_error{reason}`, `purchase_duplicate`, `purchase_consume_failed` as `interaction`; on every `granted` the Hazar `purchase` event — `offer_name`, `revenue`, `currency`, `order_id`, `source`, `status` (`success` | `restore`). `price(productId)` is the host's real catalog; without it the event carries no revenue. `next` runs even when the analytics side throws (it saves the profile).

**Restore and revenue (parity review).** The donor DOES send a purchase/revenue event for a restored receipt: `trackPurchase` has one call site, `DataUpdateSystem.ts:178` inside `onShopPurchase`, and `onCheckConsummations` (`:52-63`) feeds every restored purchase through that same method — deliberately ("РЕВЬЮ 15.09 №8: ЕДИНСТВЕННАЯ точка события purchase — … и восстановленные чеки (check.consummations), которые раньше в выручку не попадали"), together with `recordPayment`. It is not a double count: the platform lists only receipts that were NOT granted before (Yandex `:606 if (!alreadyGranted)`, CleverApps `:529 if (purchase.productId && !already)`), so a payment that was granted by the direct path is only consumed on restore and never reaches `onShopPurchase` again. Core keeps the same invariant: the Hazar `purchase` event rides on `granted`, which fires once per claimed token; a known token yields `purchase_duplicate` telemetry only. Covered by "revenue is never double-counted" in `tests/composition/purchaseAnalytics.test.ts`. The donor's event has no `status` / `source`; Core adds `status: 'restore'`, `source: 'restore'` so the backend can tell the two apart.

Offers: `resolveGrant: (id) => offers.offerByProduct(id)?.rewards ?? …` and `offers.onPurchased(event.productId)` in `next` — both in the host's composition; no import in either direction.

## 7. Host-side (not in Core)

Platform adapters (Yandex / CleverApps / Samsung), SDK timeouts, the localStorage registry adapter, restore orchestration (boot, 3 / 15 / 45 s waves, 7 / 14 s retries), `recordPayment` / `pay_*` profile fields, `user.save` + its retries, `markPayer` persistence, the guest "cloud write blocked → do not sell" gate, banner hiding for payers, economy-grant analytics.

## 8. Tests / proof

`tests/purchases/` (41) + `tests/composition/purchaseAnalytics.test.ts` (5): grant-once and the donor order on all four paths, no double revenue, cancel / error / throw, duplicates, consume failure, both restore policies, amnesiac registry, tokenless, foreign / missing product, grant throws, races, busy, registry cap / persistence / throwing store, payer, throwing `onEvent`, dispose, purity (no DOM / Date / timers / renderer / SDK, no cross-runtime import), public API, Analytics and OfferRuntime composition. Fake adapter with real receipt semantics (held until consumed). Showcase: `npm run showcase:purchase`.

## 9. Known gaps

- No server-side receipt validation (the donor has none; Yandex `signed: false`).
- The registry is per device, like the donor's: a consume that keeps failing + a new device re-grants under `before-consume`, never under `after-consume`.
- Donor order, donor consequences: a throwing `grant` / a missing reward mapping loses the purchase (already marked and consumed). Hosts must not throw from `grant` for a mapped product. ~~A tab closed during the consume await loses the grant~~ — fixed, §10.
- ~~A `consume` that never settles keeps `purchase()` pending and delays the grant~~ — fixed, §10; it now holds only the `RestoreResult` of an `after-consume` pass (and `busy` for the next pass), so the adapter must still time its SDK calls out (Yandex: 8 s).
- Non-donor items that remain, all on the idempotency side: the `duplicate` check on a direct purchase, the live registry re-check, `busy`, a product-less restored receipt is not consumed.
- Real adapters and the Trail Arrow adapter/proof are the next slices.

## 10. Consume order fix (2026-09-24, approved slice — supersedes §5.1–§5.4 where they differ)

**Defect (P0, Trail Arrow review 20.09 №10, fixed in production 0.1.31).** The order of §5.1 put the consume between the mark and the grant: `claim → await consume → grant`, and a restore pass granted only after ALL its consumes. A tab closed during that await, a consume that never settled, or a consume that settled after another receipt hung, left the token marked (and maybe consumed) but not granted — the registry then kept every later restore from granting it: a paid purchase lost. Reproduced by `tests/purchases/consume-order.test.ts` (11 of its 12 cases fail on d773319: at the consume call the state was `coins=0 marked=true`).

**Invariant.** Once the platform confirmed a payment, no consume — hanging, failing or cut off — may create a state where the payment cannot be restored while the item was not granted; one token is still granted once.

**New orders.**

| Path | Order |
|---|---|
| Direct, both platforms (whatever `restoreGrant` says) | ok → claim → grant → `granted` → consume **not awaited** (failure → `consume_failed`) → answer. Production 0.1.31 Yandex `:618-629`, CleverApps `:966-974`. |
| Restore, `before-consume` (CleverApps) | per receipt: known? → claim → grant → consume (failure ignored). 0.1.31 still grants after the consume and the pass; Core grants at the mark — the mark is what makes a later grant impossible. |
| Restore, `after-consume` (Yandex) | per receipt: known? → consume → claim → grant as soon as THIS consume answered; the consumes of a pass run together. 0.1.31 keeps consume → mark → grant but grants the whole pass from its answer. |
| Entitlement | unchanged (never consumed); restored ones are granted in the pass, not after it. |

Why the direct path and the restore differ, on purpose: the platform's ok answer comes once per payment, so granting on it cannot repeat; a held receipt is listed on EVERY pass, so under `after-consume` the thing that happens once is the platform-side consume — that keeps a receipt from being granted on every start when the registry cannot persist (private mode). `restoreGrant` stays a restore-only policy; the direct path has none. Both are pinned: "the order is explicit" in `consume-order.test.ts`, "restore order per receipt" in `runtime.test.ts`.

**Dedup / durability — unchanged.** Seen = listed or answered; claimed = the registry mark (the only durable state Core owns, persisted by the host); delivered = `grant` + `granted` (the host persists the profile on it); consumed = the platform's own state. The claim is still one synchronous "known? + mark" block and the grant follows it in the same block, so no await can separate the mark from the grant any more (except `after-consume`, where nothing is marked before the consume answered). No new double-grant path: the mark still precedes every consume, as before.

**What is still open (not this slice).**
- `after-consume` restore: a consume that lands on the platform while its answer is lost (tab closed, the adapter's 8 s timeout) loses that one receipt — inherent to consume-first. **Closed in ledger mode (§11)**; legacy keeps it.
- The host's durability gap: the registry mark is usually written synchronously (localStorage), the profile on `granted` asynchronously (cloud); a tab closed in between keeps the mark and loses the item. Same in the donor. NOT closed by "`grant` returns its save promise, mark after it" — that only moves the window: product durable + mark lost → the next restore grants twice. Registry and product state are two independent durable writes; only ONE durable write holding the effect and the applied token (idempotent apply by token, owned by whoever owns the value) plus consume after that write's ack closes both. Reproduced in `tests/purchases/crash-windows.test.ts` (`test.fails` = open window).
- Without a working registry (private mode) a direct purchase whose consume never lands is granted now AND by the next launch's restore — the same as a failed consume under §5.1.

## 11. Purchase Ledger V1 (2026-09-24) — the production-safe path for consumables

**Why a new path.** `tests/purchases/crash-windows.test.ts` proves the legacy contract cannot be crash-safe: the granted registry and the product state are two independent durable writes of the host, so a crash between them loses the item (registry first — CASE 1) or grants it twice (product first — CASE 2, which is exactly "grant returns its save promise, mark after"); `after-consume` restore also loses a receipt whose consume landed while its answer was lost (CASE 3). Exactly-once of an EFFECT needs the effect and the token in ONE durable write — only the owner of the value can do that. Core orchestrates; the owner applies.

**Contract (additive, opt-in).** `PurchaseRuntimeOptions.ledger?: PurchaseLedger<TGrant>`:

```ts
type PurchaseLedgerApplyResult = 'applied' | 'already_applied' | 'not_durable';
interface PurchaseLedgerEntry<TGrant> { token: string; productId: string; rewards: TGrant; context: PurchaseGrantContext }
interface PurchaseLedger<TGrant> { apply(entry): PurchaseLedgerApplyResult | PromiseLike<PurchaseLedgerApplyResult> }
```

ONE operation, never `isApplied` + `apply` (a check-then-act pair is a race). Owner obligations (JSDoc of `PurchaseLedger`): (1) atomic — effect + token in one durable write of one record; (2) idempotent by token, for confirmed AND pending tokens; (3) honest — `applied` / `already_applied` only for a token in a CONFIRMED write (a storage `set` that answered true — Yandex since 75a7aea); (4) deterministic — the write carries the whole record, never a blind `+= n`; (5) the record is loaded before `restore()`. An answer that is not `applied` / `already_applied` (a throw, a rejection, garbage) reads as `not_durable` — fail closed.

**Pipeline (ledger mode, consumables).** Direct and restore alike, `restoreGrant` does not order consumables: confirmed payment → token? (none → `no_token`, not consumed) → legacy registry knows it? (→ `duplicate`, consume only — migration: a token granted before the switch is never applied again) → `resolveGrant` (none / throws → `no_grant` / `grant_threw`, NOT consumed — the receipt waits until the config is fixed) → `apply` (at most one in flight per token; a second attempt joins it and reads its `applied` as `already_applied`) → `applied`: `granted` event, then consume (not awaited on the direct path) · `already_applied`: `duplicate` event, consume · `not_durable`: `error{not_durable}`, NOTHING consumed, direct result `error` with `restoreAdvised: true`. Receipts of a restore pass are independent chains; the `RestoreResult` waits for their consumes, no delivery does.

**Crash semantics.** The receipt is consumed only after the effect is durable, and the owner's apply is idempotent — so a death at any point either leaves the receipt on the platform with no durable effect (the next restore applies it once) or leaves a durable effect (the next restore answers `already_applied` and only consumes). The `LEGACY OPEN` windows pass in `tests/purchases/ledger.test.ts` (CASE 1 → test 4, CASE 2 → test 6, CASE 3 → test 8), with the ambiguous ACK (written, answered false) retried safely in one session and after a restart (test 5).

**Ownership.** Core-owned value (a future Wallet pack): the effect and the applied tokens live in one Core record and go out in one `SaveGate.writeCore` — not built in V1, the contract needs no redesign for it. Gameplay-owned value (SoliPix coins): the HOST implements `apply` over its own save (coins + `appliedPurchaseTokens` in the same object); Core cannot verify that atomicity — it is the host's obligation. Recommended owner shape (the test reference): the live record + the set of tokens seen in a confirmed write; apply = confirmed? → `already_applied`; else apply to the live record once (pending), write the whole record, answer by that write; any successful save of the record confirms the tokens it carries.

**Guest.** Capability-based, nothing hard-coded: a guest with a durable local record can run ledger mode; without durable storage every apply is `not_durable` → nothing consumed, nothing reported as granted, the receipt kept until a durable ledger exists (test 15).

**Entitlements.** Not routed through the ledger in V1: never consumed, the receipt listed on every restore, the flag idempotent, `owned` re-asserts it — a crash before the flag's save is healed by the next restore, repeated restores have no events, no consume (tests 13 here and in crash-windows).

**Boundary.** The guarantee is per save lineage (one device's view of the record). Two devices writing the same record concurrently over a storage without versioning / CAS (Yandex `setData` replaces the whole object, read once per session) can overwrite each other — a storage concern, not solved here.

**Legacy.** Without `ledger`: e8fbfc2 exactly — `grant` + registry + `restoreGrant`, **best-effort crash durability** for consumables (the three `LEGACY OPEN` windows). New production consumables should use the ledger. Downgrading ledger → legacy is not supported (the ledger's tokens are not in the registry).

**Events.** `granted` exactly when the owner answered `applied` (the revenue point); `already_applied` → `duplicate` (telemetry, no revenue); `not_durable` → `error{not_durable}`, no `granted`; `consume_failed` may follow a `granted`. Known analytics edge: an effect that became durable through an ambiguous write or another save of the record answers `already_applied` later — delivered, but never reported as `granted` (no revenue event for it).

