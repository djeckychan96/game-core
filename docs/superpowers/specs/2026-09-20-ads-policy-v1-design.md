# Ads Policy Config V1 — design

Branch `feat/ads-policy-v1.0` on top of `feat/ready-ui-overlay-v0.9`. Extends AdsRuntime v0.7
(`docs/superpowers/specs/2026-09-17-ads-runtime-v0.7-design.md`) — nothing of v0.7 is rewritten or
re-decided; the tables engine is the same code path, wrapped.

## 1. Goal

Gameplay must hold no ad condition (`if (level % 3 === 0 && cooldownPassed)`). It reports a
placement — `ads.requestInterstitial('level_complete')` — and AdsRuntime answers an explainable
decision from a **per-game policy**: is the kind on, is the placement listed, what does NO_ADS
block, the first-show delay, the session cap, the cadence, the cooldown floors, the per-placement
caps — and, when the game has them, the segmentation tables of v0.7 (Trail Arrow's `AdsGate`).
The platform adapter only shows.

```
Game ─▶ AdsRuntime (policy gates → segmentation tables) ─▶ PlatformRuntime.ads ─▶ YandexPlatform / CleverAppsPlatform
```

Out of scope, on purpose: SoliPix integration, Yandex wiring, CleverApps, an analytics transport,
UI. No gameplay of Trail Arrow changes.

## 2. Module layout

| File | Role |
| --- | --- |
| `src/ads/policy.ts` | `AdsPolicy` and its section types, `AdsPolicyOverrides`, `resolveAdsPolicy` (deep merge, no mutation, validated, frozen), `adsPolicyFromConfig` (v0.7 semantics as a policy), `validateAdsPolicy`, `freezeAdsPolicy`, `ADS_POLICY_NEUTRAL` |
| `src/ads/presets.ts` | `TRAIL_ARROW_ADS_CONFIG_V1` (the donor tables as a literal) and `TRAIL_ARROW_AD_POLICY_V1` (frozen) |
| `src/ads/AdsRuntime.ts` | the pipeline: policy gates, then the v0.7 tables engine; `evaluate` / `request*` / `startSession` / `getPolicy`; `decide` and the three `canShow*` unchanged |
| `src/ads/types.ts` | `AdsDenyReason` + 6 policy reasons, `AdsPolicyDecision`, `AdsDecisionSource`, `AdsInput.isAdInFlight?`, `AdsRuntimeOptions.policy?` / `config?`, `AdsRuntimeStats.policy` + `.session` |

The preset is game DATA shipped as a named constant (the tables verbatim, a name, a version); the
runtime never references it — a game that does not want it never loads its numbers into a decision.

## 3. The policy

```ts
interface AdsPolicy {
  name: string; version: number;                      // analytics cohort: `trail_arrow@1`
  interstitial: { enabled; cooldownMs; afterRewardedCooldownMs; firstShowDelayMs; minLevel; placements: Record<id, { enabled; cadence?; minLevel?; dayLimit?; hourLimit? }> };
  rewarded:     { enabled; minLevel; placements: Record<id, { enabled; minLevel?; dayLimit?; hourLimit? }> };
  banner:       { enabled; minLevel; placements: Record<id, { enabled; minLevel? }> };
  noAds:        { blocksInterstitial; blocksBanner; blocksRewarded };   // rewarded stays on by default
  session:      { maxInterstitials: number | null; blockWhileAdInFlight: boolean };
  segmentation: AdsConfig | null;                     // the v0.7 tables; null = policy-only game
}
```

- **Placement ids are the game's strings** (`AdsPlacementId = string`; a game narrows it to a
  union). The `placements` records are allow-lists: unlisted or `enabled: false` → `placement_disabled`.
- **Cooldown floors.** `cooldownMs` / `afterRewardedCooldownMs` never shorten a segment's delay:
  effective = `max(policy ms, segment seconds · 1000)`. `0` = the tables alone (the preset).
- **Cadence** (interstitial placements only): every N-th request passes; the count is
  per placement, per session, moves only when the request reached the cadence check, restarts at 0
  on a confirmed show of that placement; `first` names the request that passes before the first
  show. A request that passed the cadence but was refused later stays due (the next one passes).
- **Session** = the runtime's lifetime, or from `startSession()`: `firstShowDelayMs` counts from
  `input.now()` at construction / `startSession()`; `maxInterstitials` counts confirmed
  interstitials; `blockWhileAdInFlight` reads the new optional `input.isAdInFlight()`.
- **Caps** at placement level (`dayLimit` / `hourLimit`) use the v0.7 calendar counters; with
  tables the tighter of the two binds.
- `resolveAdsPolicy(base, ...overrides)`: objects merge key by key in depth (a placement record
  keeps unnamed placements, a cadence keeps unnamed fields), anything else replaces, `null` clears
  an optional knob, `undefined` is no override, `segmentation` is atomic (replaced whole, never
  merged row by row). The result is a deep copy, validated, frozen; base / overrides / presets are
  never touched. Presets are deep-frozen: a mutation throws.

## 4. Decision order

```
interstitial: disabled → no_ads → unknown_placement | wrong_type | placement_disabled → ad_in_flight
              → below_start_level (policy) → first_show_delay → session_limit → cadence
              → [tables] no_segment → segment_disabled → no_rule → below_start_level
              → day_limit → hour_limit → inter_cooldown → reward_cooldown
rewarded:     disabled → no_ads (only if noAds.blocksRewarded) → placement gates → ad_in_flight → below_start_level (policy)
              → [tables] no_segment → no_rule → below_start_level → day_limit → hour_limit        (no cooldowns)
banner:       disabled → no_ads → placement gates → below_start_level (policy)
              → [tables] no_segment → no_rule → below_start_level                                 (no counters, no cooldowns)
```

`AdsPolicyDecision = { allowed, reason, segmentId, placement, adType, level, source: 'policy' | 'segmentation' | null, policy: { name, version } }`.
`decide()` returns the v0.7 triple; events keep their v0.7 shapes (a policy refusal is a plain
`denied` with its reason, so `adsAnalytics.ts` reports it unchanged).

## 5. Compatibility

- `new AdsRuntime({ config })` = `{ policy: adsPolicyFromConfig(config) }`: every placement of the
  tables enabled, every knob neutral, the tables by REFERENCE (unfrozen). The whole v0.7 suite runs
  through this path unchanged; `tests/ads/policy-runtime.test.ts` runs a long scripted life through
  `TRAIL_ARROW_AD_POLICY_V1` and through `{ config: parseAdsTsv(...) }` side by side and asserts
  identical decisions, events, persisted state and stats.
- Two old assertions were extended structurally, no expectation weakened: the `src/ads` file list
  (`policy.ts`, `presets.ts`) and the exhaustive `denyByReason` record (six zero keys).
- One Core-internal edge changed: `decide(x, 'banner')` for a non-banner `x` now answers
  `wrong_type` (v0.7 checked no type there, like the donor's `canShowBanner()` which always asks
  for `banner`). Production `canShowBanner()` is unaffected.
- `TRAIL_ARROW_AD_POLICY_V1` is **not** the default of anything. When Oleg confirms the scheme:
  `export const DEFAULT_AD_POLICY = TRAIL_ARROW_AD_POLICY_V1` (or a `resolveAdsPolicy(...)` of it).

## 6. Host / platform-specific (not in Core)

The donor's window-level guards stay where they are: `pendingContinue` / `pendingFail` and the
12 s / 150 s interstitial waits (`INTER_START_TIMEOUT_SEC` / `INTER_HARD_CAP_SEC`), the rewarded
belts (`REWARDED_BELT_SEC` 130 s, OutOfSpace 75 s — B5), `AdsShowingComponent`, the NO_ADS offer
counter of `InterstitialAdsSystem` (every 3rd interstitial from L17), sound pause. A host that
wants the in-flight guard in Core sets `session.blockWhileAdInFlight` and supplies
`input.isAdInFlight`. Showing, watchdogs, `registerShown` after a platform ok, the device clock and
calendar are the adapter's / host's, as in v0.7.

## 7. Tests / proof

`tests/ads/policy.test.ts` (11): merge depth, null / undefined / left-to-right, atomic
segmentation, no mutation + frozen result + frozen presets, determinism, validation matrix (26
refusals), `adsPolicyFromConfig`, preset parity with the verbatim TSVs and the donor's generated
config. `tests/ads/policy-runtime.test.ts` (17): the decision object, enabled / disabled, placement
gates, cooldown to the ms and the floor semantics over the tables, first-show delay +
`startSession`, session cap, in-flight, cadence (three tests), NO_ADS switches, levels and caps
without tables, tighter-of-two caps over the tables, determinism across runtimes, the constructor,
the differential Trail Arrow life. `npm test`, `npx tsc --noEmit`, `npm run build` green.
