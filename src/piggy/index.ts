// Piggy Bank V1 (root entry `game-core`): the GDD «Свинья копилка» bank over the SaveGate Core record `piggyBank`.
export { PiggyBankService, PIGGY_BANK_SOURCE } from './PiggyBankService';
export { validatePiggyBankConfig, piggyBankThreshold, piggyBankAccrual, piggyBankGddExample } from './config';
export type {
  PiggyBankPrice,
  PiggyBankLevel,
  PiggyBankConfig,
  PiggyBankStatus,
  PiggyBankProblem,
  PiggyBankState,
  PiggyBankSnapshot,
  PiggyBankStageEntry,
  PiggyBankRefusal,
  PiggyBankStageResult,
  PiggyBankCollectResult,
  PiggyBankBuyResult,
  PiggyBankApplyResult,
  PiggyBankPurchaseEntry,
  PiggyBankChange,
  PiggyBankListener,
  PiggyBankWallet,
  PiggyBankSaveGate,
  PiggyBankServiceOptions
} from './types';
