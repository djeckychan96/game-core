# Ads Policy V1.1 — the NO_ADS offer cadence and the platform-answer watchdog numbers (2026-09-21)

Branch `feat/ads-policy-v1.1` over `feat/ads-policy-v1.0` (404d9dd). Donor: `trail_arrow-latest` (read only).

## What the donor really does (established before any code)

**"130 s / 75 s rewarded belts"** are NOT ad-policy eligibility. They are watchdog timers of two windows:
- `LevelCompleteWindowSystem.onBtnAds`: the x2 button is tapped → the window locks its buttons, arms
  `x2UnlockTimer = REWARDED_BELT_SEC (130 s)` and sends `ads.rewarded { placement: ad_level_win_x2_rewarded }`.
  The timer counts from the REQUEST. If the platform's answer (any status) does not arrive in time, the
  system synthesizes `onAdsRewarded({ status: 'error' })` to unlock the window. The timer is killed by the
  answer and by the window closing. While it is alive, Continue / × / x2 taps are ignored (`onBtnContinue`
  returns before even asking `AdsGate.canShowInter`).
- `OutOfSpaceWindowSystem.onBtnAdsMoves`: the same pattern with a hardcoded 75 s (`unlockTimer`) for
  `ad_extra_moves_rewarded` — audit B5: the constant was raised to 130 s (REVIEW 15.09 №14: longer than the
  platform's 90 / 120 s show timeouts, so a late ok cannot lose the reward) but this window still has 75.
- Nothing in `AdsGate` knows these timers; they never deny a placement; there is no per-placement "belt"
  besides these two windows. The interstitial side has the same shape: `pendingContinue` / `pendingFail`
  + `INTER_START_TIMEOUT_SEC 12` (only while the show has not begun), `INTER_HARD_CAP_SEC 150` while a
  show is in progress, re-checked every `INTER_RECHECK_SEC 5`.

**The NO_ADS offer after interstitials** (`InterstitialAdsSystem`): `NO_ADS_OFFER_PERIOD = 3`; the counter
starts at `PERIOD − 1`, so the FIRST confirmed interstitial raises the offer, then every 3rd (1st, 4th, 7th …).
Only `status === 'ok'` answers count (`registerShown` sits behind the same check); rewarded answers arrive
on another message and never count. With NO_ADS owned or `level < Balance.NO_ADS_MIN_LEVEL (17)` the
counter does not move at all. The trigger only sets `helpers.pendingNoAdsOffer`; `MainScreenSystem` shows
`OfferNoAdsWindow` later (map shown, no window open, no unlock animation, ≥ 0.8 s after the screen) and
drops the flag if NO_ADS was bought meanwhile. The counter lives in memory (a session), never persisted.

## What became Core

- `AdsNoAdsPolicy.offerAfterInterstitials?: { enabled, every, first?, minLevel } | null` — `registerShown`
  of an interstitial placement counts (not with NO_ADS, not below `minLevel`), the N-th raises the trigger,
  emits `no_ads_offer { placement, segmentId, level, interstitials }`; `consumeNoAdsOffer()` (true once,
  re-checks NO_ADS), `isNoAdsOfferDue()`, `stats.session.noAdsOffer`; `startSession()` restarts it.
- `AdsPolicy.timeouts?: AdsRequestTimeouts` + `rewarded.placements[id].answerTimeoutMs?` — data only;
  `getRequestTimeouts(placement)` resolves them; `ADS_POLICY_NEUTRAL.timeouts` = the donor numbers.
- `TRAIL_ARROW_AD_POLICY_V2` (V1 untouched, still equal to `adsPolicyFromConfig(tables)`; no default).

## What stays host-side, and why

The timers, the button locks and the pending-transition flags: they orchestrate a window around a
platform answer (UI state, gsap timers, ECS messages) — Core has no clock, no timers and no windows in
`src/ads/`, and a "belt" never changes WHETHER an ad may show (V1's `session.blockWhileAdInFlight` +
`input.isAdInFlight()` already covers "x2 in flight → Continue waits" for a host that wants it in Core).
