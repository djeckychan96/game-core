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
- Donor order, donor consequences: a throwing `grant` / a missing reward mapping loses the purchase (already marked and consumed); a tab closed during the consume await loses the grant. Hosts must not throw from `grant` for a mapped product. Changing this is a financial-behavior decision for a later, explicitly approved slice.
- A `consume` that never settles keeps `purchase()` pending (`busy` for the next one) and delays the grant — the adapter must time its SDK calls out (the donor: 8 s).
- Non-donor items that remain, all on the idempotency side: the `duplicate` check on a direct purchase, the live registry re-check, `busy`, a product-less restored receipt is not consumed.
- Real adapters and the Trail Arrow adapter/proof are the next slices.
