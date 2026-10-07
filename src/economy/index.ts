// SoftCurrencyWallet V1 (root entry `game-core`): a core-owned soft currency over the SaveGate Core record.
export { SoftCurrencyWallet } from './SoftCurrencyWallet';
// Star-tiered level reward: the coins of a won attempt from the level's base reward and its stars (a wallet policy calls it).
export { coinRewardForStars } from './levelReward';
export type {
  SoftCurrencyWalletStatus,
  SoftCurrencyWalletProblem,
  SoftCurrencyRefusal,
  SoftCurrencyChangeContext,
  SoftCurrencyResult,
  LevelRewardKind,
  LevelRewardResult,
  SoftCurrencyChangeKind,
  SoftCurrencyChange,
  SoftCurrencyListener,
  SoftCurrencyWalletSnapshot,
  SoftCurrencySaveGate,
  SoftCurrencyWalletOptions
} from './SoftCurrencyWallet';
