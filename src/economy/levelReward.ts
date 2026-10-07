// Star-tiered level reward — the generic rule that turns a level's base coin reward (`LevelBalance.baseCoinReward`)
// into the coins of one WON attempt by its stars: 3 → N, 2 → ¾ N, 1 → ½ N, 0 → ¼ N, a fraction rounded UP. It pays
// nothing itself: SoftCurrencyWallet stays the one payer (first completion once, replays opt-in, a fail never), and
// the profile's `levelReward` / `replayReward` policy is where a host calls it with the level's base and the result's
// stars. No reward number lives here — the base is level data.
import type { LevelStars } from '../moves/balance';

/**
 * The coins of a won attempt with `stars` (0–3) on a level whose 3-star reward is `baseCoinReward`:
 * ceil(baseCoinReward × (stars + 1) / 4). Throws a RangeError for a base that is not an integer ≥ 0 or stars outside
 * 0–3 (inside a wallet policy that is an `invalid_reward` refusal: nothing is paid).
 */
export function coinRewardForStars(baseCoinReward: number, stars: LevelStars): number {
  if (!Number.isSafeInteger(baseCoinReward) || baseCoinReward < 0) throw new RangeError('coinRewardForStars: baseCoinReward must be an integer ≥ 0');
  if (!Number.isInteger(stars) || stars < 0 || stars > 3) throw new RangeError('coinRewardForStars: stars must be 0, 1, 2 or 3');
  const quarters = stars + 1;
  // whole quarters of the base, then the remainder's share rounded up — exact for every safe integer base
  return Math.floor(baseCoinReward / 4) * quarters + Math.ceil(((baseCoinReward % 4) * quarters) / 4);
}
