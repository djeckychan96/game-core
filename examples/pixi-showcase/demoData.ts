// Demo/test data for the showcase — not a production save. Shows every visual state at once:
// completed levels with 0..3 stars, a few "hard" pills, the current level, and locked ones.
import type { LevelMapLevel } from 'game-core/pixi';
import type { ShopItem } from 'game-core/pixi';

export const DEMO_LEVEL_COUNT = 36;
export const DEMO_CURRENT_LEVEL = 19;
export const DEMO_MAX_LIVES = 5;

export interface DemoState {
  coins: number;
  lives: number;
  /** seconds until the next life */
  refillSeconds: number;
  currentLevel: number;
  levels: LevelMapLevel[];
}

export function createDemoState(): DemoState {
  const starPattern = [3, 2, 3, 1, 3, 3, 2, 0, 3, 1, 2, 3, 3, 2, 1, 3, 2, 3];
  const levels: LevelMapLevel[] = [];
  for (let i = 1; i <= DEMO_LEVEL_COUNT; i++) {
    const level: LevelMapLevel = { index: i, stars: i < DEMO_CURRENT_LEVEL ? starPattern[(i - 1) % starPattern.length] ?? 0 : 0 };
    if (i % 7 === 0) level.hard = true;
    levels.push(level);
  }
  return {
    coins: 12450,
    lives: 3,
    refillSeconds: 17 * 60 + 42,
    currentLevel: DEMO_CURRENT_LEVEL,
    levels
  };
}

export const DEMO_SHOP_ITEMS: ShopItem[] = [
  { id: 'coins_1', amount: 1000, price: '$0.99' },
  { id: 'coins_2', amount: 3500, price: '$2.99' },
  { id: 'coins_3', amount: 8000, price: '$5.99' },
  { id: 'coins_4', amount: 16500, price: '$9.99' },
  { id: 'coins_5', amount: 35000, price: '$19.99' },
  { id: 'coins_6', amount: 70000, price: '$34.99' }
];

export const DEMO_REFILL_PRICE = 900;
