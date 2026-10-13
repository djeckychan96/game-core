// Piggy Bank V1 — config checks, the threshold rule and the GDD example (game data, provisional).
import type { PiggyBankConfig, PiggyBankLevel, PiggyBankPrice } from './types';

const isCount = (value: unknown, min = 0): value is number => Number.isSafeInteger(value) && (value as number) >= min;
const isPercent = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function priceIssues(price: unknown, at: string): string[] {
  if (price === null) return [];
  if (typeof price !== 'object' || price === undefined) return [`${at}.price must be null, { kind: 'product', productId } or { kind: 'wallet', amount }`];
  const p = price as Partial<PiggyBankPrice> & Record<string, unknown>;
  if (p.kind === 'product') return typeof p.productId === 'string' && p.productId !== '' ? [] : [`${at}.price.productId must be a non-empty string`];
  if (p.kind === 'wallet') return isCount(p.amount, 1) ? [] : [`${at}.price.amount must be an integer ≥ 1`];
  return [`${at}.price.kind must be 'product' or 'wallet'`];
}

/** Every problem of a config (empty = valid). The service refuses an invalid one at construction. */
export function validatePiggyBankConfig(config: PiggyBankConfig): string[] {
  const issues: string[] = [];
  if (typeof config !== 'object' || config === null) return ['config must be an object'];
  if (!isPercent(config.accrualPercent) || config.accrualPercent < 0) issues.push('accrualPercent must be a finite number ≥ 0');
  if (!isPercent(config.purchaseThresholdPercent) || config.purchaseThresholdPercent <= 0 || config.purchaseThresholdPercent > 100) {
    issues.push('purchaseThresholdPercent must be in (0, 100]');
  }
  if (!Array.isArray(config.levels) || config.levels.length === 0) {
    issues.push('levels must be a non-empty array');
    return issues;
  }
  config.levels.forEach((level: PiggyBankLevel, i) => {
    const at = `levels[${i}]`;
    if (typeof level !== 'object' || level === null) {
      issues.push(`${at} must be { capacity, price }`);
      return;
    }
    if (!isCount(level.capacity, 1)) issues.push(`${at}.capacity must be an integer ≥ 1`);
    issues.push(...priceIssues(level.price, at));
  });
  return issues;
}

/** The balance from which a bank of `capacity` can be bought: ceil(capacity × percent / 100), at least 1. */
export function piggyBankThreshold(capacity: number, purchaseThresholdPercent: number): number {
  return Math.max(1, Math.ceil((capacity * purchaseThresholdPercent) / 100 - 1e-9));
}

/** The bank's share of a level's earned reward: floor(earned × accrualPercent / 100). */
export function piggyBankAccrual(earned: number, accrualPercent: number): number {
  return Math.floor((earned * accrualPercent) / 100 + 1e-9);
}

/**
 * The GDD «Свинья копилка» numbers as an EXAMPLE, not a balance: the purchase threshold 50 % (the GDD's default), the
 * progression 3000 → 5000 → 7500 → 10000 and the bonus 150 % are the document's examples; no price or payment is
 * approved yet, so no level is for sale (price null). A game passes its own config (or overrides these fields).
 */
export function piggyBankGddExample(): PiggyBankConfig {
  return {
    accrualPercent: 150,
    purchaseThresholdPercent: 50,
    levels: [3000, 5000, 7500, 10000].map((capacity) => ({ capacity, price: null }))
  };
}
