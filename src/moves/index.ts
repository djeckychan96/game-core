// Moves V1 (root entry `game-core`): level balance data, its source seam, one attempt's move counter and the star rule.
export { validateLevelBalance, starsForMovesLeft } from './balance';
export type { LevelBalance, LimitedLevelBalance, UnlimitedLevelBalance, LevelStars, StarPolicy } from './balance';
export { createStaticLevelBalanceSource, validateLevelBalanceTable } from './source';
export type { LevelBalanceTable, LevelBalanceSource } from './source';
export { MoveRuntime } from './MoveRuntime';
export type { MoveRefusal, MoveResult, MoveSnapshot, MoveRestoreResult } from './MoveRuntime';
