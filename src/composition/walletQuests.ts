// Composition-level wiring: SoftCurrencyWallet ⇄ QuestService. Both runtimes are known only as types:
//
//   const quests = new QuestService({ …, rewards: createWalletQuestRewards(wallet) });   // rewards → wallet.grant
//   const stop = trackWalletForQuests(wallet, quests);                                  // coins earned / spent → quests
//
// The wallet stays the one payer and the one balance; the quest service never imports it.
import type { SoftCurrencyChange, SoftCurrencyChangeContext, SoftCurrencyResult, SoftCurrencyWalletSnapshot } from '../economy/SoftCurrencyWallet';
import type { QuestEvent, QuestRewardSink } from '../quests/types';

/** What the reward sink needs from the wallet — `SoftCurrencyWallet` satisfies it. */
export interface QuestRewardWallet {
  readonly currency: string;
  snapshot(): Pick<SoftCurrencyWalletSnapshot, 'writable' | 'balance'>;
  grant(amount: number, context?: SoftCurrencyChangeContext): SoftCurrencyResult;
}

/** What the event bridge needs from the wallet — `SoftCurrencyWallet` satisfies it. */
export interface QuestTrackedWallet {
  onChange(listener: (change: SoftCurrencyChange) => void): () => void;
}

/** What the event bridge needs from the quests — `QuestService` satisfies it. */
export interface QuestEventSink {
  track(event: QuestEvent): unknown;
}

export interface WalletQuestTrackingOptions {
  /** false = this balance change is not a quest action (e.g. the refund of a failed purchase). Default: every change counts. */
  filter?: (change: SoftCurrencyChange) => boolean;
}

/**
 * Quest rewards paid through the existing Core economy: a reward whose id is the wallet's currency goes to
 * `wallet.grant(amount, { source: 'quest', item: questId })`; any other id is refused (`unknown_reward`) —
 * pay other resources with a host sink. `canGrant` answers what `grant` would: the wallet is writable and the
 * amount fits.
 */
export function createWalletQuestRewards(wallet: QuestRewardWallet): QuestRewardSink {
  return {
    canGrant(reward) {
      if (reward.id !== wallet.currency || !Number.isSafeInteger(reward.amount) || reward.amount < 0) return false;
      const state = wallet.snapshot();
      return state.writable === true && state.balance !== null && Number.isSafeInteger(state.balance + reward.amount);
    },
    grant(reward, context) {
      if (reward.id !== wallet.currency) return { ok: false, reason: 'unknown_reward' };
      return wallet.grant(reward.amount, { source: 'quest', item: context.questId });
    }
  };
}

/**
 * Wallet balance changes as quest events: a gain (any source — a level, a purchase, a quest reward) is
 * `currency_earned`, a spend is `currency_spent`. Returns the unsubscribe.
 */
export function trackWalletForQuests(wallet: QuestTrackedWallet, quests: QuestEventSink, options: WalletQuestTrackingOptions = {}): () => void {
  const filter = options.filter;
  return wallet.onChange((change) => {
    if (filter && filter(change) !== true) return;
    if (change.delta > 0) quests.track({ type: 'currency_earned', amount: change.delta });
    else if (change.delta < 0) quests.track({ type: 'currency_spent', amount: -change.delta });
  });
}
