# AnalyticsRuntime v0.5 — design

Date: 2026-09-17 · Branch: `feat/analytics-runtime-v0.5` (from `feat/offer-runtime-v0.4`, e530dab)

## 1. Goal

One renderer-independent analytics API in Game Core, compatible with the production Hazar pipeline:
Core logs its own events through it, gameplay logs its events through it, and the project supplies
endpoint / JWT / app / platform / profile. The backend sits behind a transport seam and can be
replaced without touching games.

```
Game Core AnalyticsRuntime → AnalyticsTransport → Hazar transport today → another backend later
```

Rule: **Core-owned behavior is instrumented at composition level; gameplay adds game-specific events.**

## 2. Sources

- The Hazar analytics brief (endpoint, envelope, base events, batching, A/B fields) as given in the task.
- `trail_arrow-latest/src/app/AnalyticsManager.ts` (0.1.22), read-only: batch 20, 10 s cadence, cap 500
  with oldest dropped, flush on hide, immediate flush for install / session / loading, `interaction`
  events for the offer chain, the `purchase` / `advertisement` field names.

## 3. Module layout

```
src/analytics/types.ts                   envelope, context, seams, options, stats, typed events
src/analytics/AnalyticsRuntime.ts        CoreRuntimeModule: track + helpers, queue, flush, update, dispose
src/analytics/AnalyticsTransportError.ts retryable / non-retryable transport failure
src/analytics/hazarTransport.ts          createHazarAnalyticsTransport({ endpoint, token, fetchFn })
src/composition/offerAnalytics.ts        OfferRuntime events → interaction events (types only)
```

Injected seams: `AnalyticsTransport.send(events)`, `AnalyticsContext | () => AnalyticsContext`,
`AnalyticsQueueStore.load()/save(events)`, `now()` (unix seconds, optional). The runtime knows no
Pixi, DOM, platform SDK, storage, network or wall clock.

## 4. Wire contract

`POST /ingest` on `https://analytics.hazargames.ru` (RU) / `https://analytics.hazargames.com` (EU);
`Authorization: Bearer <JWT>`, `Content-Type: application/json`; body is an array of

```
{ app, p, event: { name, app_ver, build_ver?, created_at?, data: { profile_id, installed_at?, device,
  platform_os?, config_name?, config_group?, ...event-specific } } }
```

`p` is an open string with the known codes (YA, VK, OK, FB, AN, MSS, SAM, DEV, TS) for autocomplete.
`created_at` is an addition over the brief (the donor sends it): present only when the host injects
`now`, so a retried or restored event keeps its real time. The JWT is per project/platform and is
never stored in this repository.

## 5. Behavior

| Topic | Decision |
| --- | --- |
| Context | read on every `track`; invalid (`profile_id` / `app` / `platform` / `appVersion` empty, unknown `device`) → event rejected + `onError('context')` |
| Merge | `baseData` < event data < identity block; `undefined` never reaches the wire |
| Cadence | `update(frameMs)` accumulates; ≥ `flushIntervalMs` (10 000) → one flush; a long frame = one flush; returns false always |
| Batch | `batchSize` 20; a full batch triggers a flush; a flush sends the queue in order, batch by batch |
| Immediate | `install`, `sessions`, `loading` ask for a flush; track-triggered flushes coalesce to the end of the tick (microtask) |
| Concurrency | one `send` at a time; concurrent `flush()` share one promise; it never rejects; explicit `flush()` calls `send` synchronously |
| Failure | batch back to the head, order kept, flush stops; batch-size trigger paused until a success; retried by the next cadence/explicit flush |
| Non-retryable | `AnalyticsTransportError{retryable:false}` (Hazar 400/413/422) → batch dropped, counted |
| Hung send | failed by frame time after `sendTimeoutMs` (30 000); a late settle is ignored |
| Cap | `maxQueueSize` 500, oldest dropped, counted |
| Store | optional; restored (validated, capped) in the constructor; snapshot = in flight + queued saved after every change; store errors reported, never fatal |
| Dispose | saves the snapshot, then `track` / `update` / `flush` are inert; an in-flight send still settles its bookkeeping |
| Errors | nothing throws into gameplay; `onError(error, { phase })`, default warns except `send` |

## 6. Offer events (composition)

`createOfferAnalyticsHandler(analytics, next?)` is an `OfferRuntime` `onEvent`. Mapping:
`activated` → `interaction{action:'offer_activated', level, product, tier, variant}`, `expired` →
`offer_expired`, `blocked_no_price` → `offer_blocked_no_price{level}` (the donor's actions and
fields), `purchased` → `offer_purchased{…, moved}`. Revenue is not reported here: the `purchase`
event belongs to the purchase flow. `OfferRuntime`'s public API is unchanged.

## 7. Future slices

`PurchaseRuntime` / `AdsRuntime` will emit their own `onEvent`s; composition handlers next to
`offerAnalytics.ts` map them to `analytics.purchase({ offerName, productId, revenue, currency,
orderId, status, source })`, `analytics.advertisement({ type, placement, status, revenue? })` and
`analytics.economy({ currency, action, delta, balance, source, item })`. No change to
`AnalyticsRuntime` is needed.

## 8. Known gaps

- Trail Arrow 0.1.22 posts flat events (`{ name, app_ver, build_ver, created_at, data }`, app/platform
  implied by the JWT); this module sends the `{ app, p, event }` envelope of the brief. Confirm the
  accepted shape with the ingest owner before the Trail Arrow adapter; if needed it is a transport-level
  mapping, not a runtime change.
- No localStorage store adapter, no lifecycle listeners, no "install once" / session counter — host concerns.
- No event id: server-side dedupe (`eid`) can be supplied through `baseData` by a host with a uuid source.
- A timed-out send that was in fact delivered is retried (possible duplicate).
- `keepalive` requests are limited to ~64 KB by browsers: keep `batchSize` × event size under it.
