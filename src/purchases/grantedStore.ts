import type { GrantedPurchaseStore } from './types';

/** The donor keeps the last 50 granted tokens: older receipts were consumed long ago. */
export const DEFAULT_GRANTED_PURCHASE_CAP = 50;

export interface GrantedPurchaseStoreOptions {
  /** Tokens saved earlier, oldest first (garbage and duplicates are dropped, the cap applies). */
  initial?: readonly unknown[];
  /** How many tokens to keep; the oldest go first. Default 50, like the donor. */
  cap?: number;
  /** Called with the whole list after every new token — the host's persistence hook. */
  onChange?(tokens: string[]): void;
}

export interface MemoryGrantedPurchaseStore extends GrantedPurchaseStore {
  /** A copy of the registry, oldest first. */
  tokens(): string[];
}

/**
 * The granted-token registry in memory (Trail Arrow's `grantedTokens` / `markGranted` without the
 * storage): `add` ignores a known token, keeps insertion order and drops the oldest beyond `cap`.
 * For tests and demos as is; a game persists it through `onChange` + `initial`, or implements
 * `GrantedPurchaseStore` over its own storage.
 */
export function createGrantedPurchaseStore(options: GrantedPurchaseStoreOptions = {}): MemoryGrantedPurchaseStore {
  const cap = options.cap ?? DEFAULT_GRANTED_PURCHASE_CAP;
  if (!(Number.isInteger(cap) && cap > 0)) throw new RangeError('createGrantedPurchaseStore: cap must be a positive integer');
  const onChange = options.onChange;
  let list: string[] = [];
  for (const token of options.initial ?? []) {
    if (typeof token === 'string' && token !== '' && !list.includes(token)) list.push(token);
  }
  list = list.slice(-cap);

  return {
    has: (token) => list.includes(token),
    add: (token) => {
      if (token === '' || list.includes(token)) return;
      list.push(token);
      list = list.slice(-cap);
      onChange?.([...list]);
    },
    tokens: () => [...list]
  };
}
