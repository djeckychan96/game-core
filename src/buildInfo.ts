export interface GameCoreBuildInfo {
  version: string;
  /** Short git commit this build was made from; suffixed "-dirty" when the working tree had
   * uncommitted changes at build time (see `dirty`). Never fakes a clean commit. */
  commit: string;
  /** True if the working tree was not clean (staged/unstaged/untracked changes) at build time. */
  dirty: boolean;
  builtAt: string;
}

declare const __GAME_CORE_BUILD_INFO__: GameCoreBuildInfo | undefined;

const fallback: GameCoreBuildInfo = { version: '0.0.0-dev', commit: 'unknown', dirty: false, builtAt: '' };

/**
 * Identifies which game-core commit/version produced this build, so a vendored artifact
 * (e.g. word_tide/assets/vendor/game-core/game-core.iife.js) can be traced back to source.
 * Populated at build time via vite.config.ts's `define`; falls back when unset (e.g. a
 * consumer bundling this source directly without that define).
 */
export const BUILD_INFO: GameCoreBuildInfo =
  typeof __GAME_CORE_BUILD_INFO__ !== 'undefined' ? __GAME_CORE_BUILD_INFO__ : fallback;
