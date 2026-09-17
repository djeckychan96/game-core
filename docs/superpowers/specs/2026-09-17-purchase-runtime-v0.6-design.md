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

**Direct:** `started` → adapter → (`cancelled` | `error`) or ok → payer → `has(token)`? → `resolveGrant` → `grant` → `add(token)` → `granted` → `consume` → result.

- check → grant → mark is **one synchronous block** (`grantOnce`), shared by both paths; re-checked after every await, so a restore racing a direct purchase of the same receipt grants once whichever continuation runs first.
- Mark **before** consume — the donor's property. Difference from the donor: the grant (and the `granted` event, on which the host saves) happens before the consume, not after it. Reasons: the runtime has no timer to bound a hanging consume; a tab closed mid-consume must not lose a paid purchase; a throwing `grant` must leave the purchase unmarked and unconsumed so `restore()` retries it. At-most-once is unchanged — grant and mark are adjacent synchronous statements.
- `duplicate`: a known token on a direct purchase is consumed, not granted. The donor has no check on this path; added because exactly-once is the module's contract (an owned product, a replayed answer).
- The grant follows the product the platform reports; `requestedProductId` is carried in the context, the event and the analytics.
- `no_grant` (no reward mapping) / `grant_threw`: nothing marked, nothing consumed — recoverable by a later build + `restore()`. The donor consumed such a purchase and only warned.
- No token → granted, not marked (CleverApps semantics); the Yandex adapter answers `cancelled` without a token, as today.
- A second `purchase()` while one is in flight → `busy`, the adapter is not called (the donor guards this in each window).
- Adapter rejection / sync throw → `error: adapter_threw`. Never rejects.
- `restoreAdvised` = cancelled | error (except `no_grant`): the payment may have gone through — the host runs its waves.

**Restore:** one pass, `busy` while one runs. Per purchase: no product id → `error: no_product_id`, left on the platform; known token → `duplicate`, consume only; otherwise by policy — `after-consume` (Yandex; the default when the adapter has `consume`): consume → grantOnce, a failed consume skips the grant and keeps the receipt; `before-consume` (CleverApps; also what an adapter without `consume` gets): grantOnce → consume, failure ignored. Adapter rejection → `status: 'error'` + `restore_failed`; the host retries.

**Dispose:** new calls → `disposed`; a platform answer arriving later is not acted on (no grant, mark, consume — the next runtime's `restore()` picks it up). One exception: a purchase a restore pass has already consumed is still granted — it would never come back.

## 6. Composition

`createPurchaseAnalyticsHandler(analytics, price, next)`: `purchase_started`, `purchase_ok`, `purchase_restored`, `purchase_cancelled`, `purchase_error{reason}`, `purchase_duplicate`, `purchase_consume_failed` as `interaction`; on every `granted` the Hazar `purchase` event — `offer_name`, `revenue`, `currency`, `order_id`, `source`, `status` (`success` | `restore`). `price(productId)` is the host's real catalog; without it the event carries no revenue. `next` runs even when the analytics side throws (it saves the profile).

Offers: `resolveGrant: (id) => offers.offerByProduct(id)?.rewards ?? …` and `offers.onPurchased(event.productId)` in `next` — both in the host's composition; no import in either direction.

## 7. Host-side (not in Core)

Platform adapters (Yandex / CleverApps / Samsung), SDK timeouts, the localStorage registry adapter, restore orchestration (boot, 3 / 15 / 45 s waves, 7 / 14 s retries), `recordPayment` / `pay_*` profile fields, `user.save` + its retries, `markPayer` persistence, the guest "cloud write blocked → do not sell" gate, banner hiding for payers, economy-grant analytics.

## 8. Tests / proof

`tests/purchases/` (40) + `tests/composition/purchaseAnalytics.test.ts` (4): grant-once and its order, cancel / error / throw, duplicates, consume failure, both restore policies, amnesiac registry, tokenless, foreign / missing product, grant throws, races, busy, registry cap / persistence / throwing store, payer, throwing `onEvent`, dispose, purity (no DOM / Date / timers / renderer / SDK, no cross-runtime import), public API, Analytics and OfferRuntime composition. Fake adapter with real receipt semantics (held until consumed). Showcase: `npm run showcase:purchase`.

## 9. Known gaps

- No server-side receipt validation (the donor has none; Yandex `signed: false`).
- The registry is per device, like the donor's: a consume that keeps failing + a new device re-grants under `before-consume`, never under `after-consume`.
- `after-consume` + a throwing `grant` after a successful consume loses that purchase (as in the donor); hosts must not throw from `grant` for a mapped product.
- A `consume` that never settles keeps `purchase()` pending (`busy` for the next one) — the adapter must time its SDK calls out.
- Real adapters and the Trail Arrow adapter/proof are the next slices.
