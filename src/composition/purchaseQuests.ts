// Composition-level wiring: PurchaseRuntime → QuestService, types only on both sides. Chain it in the host's
// purchase handler:
//
//   onEvent: (event) => { const quest = purchaseEventToQuestEvent(event); if (quest) quests.track(quest); … }
import type { PurchaseEvent } from '../purchases/types';
import type { QuestEvent } from '../quests/types';

/**
 * The quest event of a CONFIRMED real-money purchase: a direct `granted` (the platform answered ok and the
 * reward was given). A restored receipt is not counted — it is an earlier payment delivered late, or a
 * permanent right coming back — and nothing else is a purchase. The token is the event id, so the same
 * receipt counts once per day.
 */
export function purchaseEventToQuestEvent(event: PurchaseEvent): QuestEvent | null {
  if (event.type !== 'granted' || event.restored) return null;
  return event.token ? { type: 'purchase', id: `purchase:${event.token}` } : { type: 'purchase' };
}
