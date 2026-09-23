// Gameplay Contract V1 — the seam between a ready gameplay and Game Core, reduced to what BOTH clean
// integrations already do (solipix-core-clean: gameplayHost / services / actions; gorodki-core-clean:
// startGame(host) + window.GORODKI). TYPES ONLY: nothing in Core implements or calls it yet. One-game
// features (hints, no-moves, board layout, lives, boosters, language …) stay outside on purpose.

/** A game-specific metric value (SoliPix moves left, Gorodki throws used / resolution reason). */
export type GameplayMetricValue = number | string | boolean;

/** Game-specific numbers of one run. Core never reads a key by name: it only hands the record on (levelReward, analytics). */
export type GameplayMetrics = Readonly<Record<string, GameplayMetricValue>>;

/** Which level: `level` is the 1-based number the level map shows and `startLevel` takes; `levelId` is the game's own id when it is not that number (Gorodki `classic-6`) — the same pair as `AnalyticsLevelEvent`. */
export interface GameplayLevelRef {
  level: number;
  levelId?: string;
}

export type GameplayLevelStart = GameplayLevelRef;

/** The end of one run: SoliPix onWin / onLose, Gorodki finish(win). */
export interface GameplayLevelResult extends GameplayLevelRef {
  win: boolean;
  /** The FIRST win of this level, decided by the gameplay BEFORE it updates its own progress (SoliPix `isLevelCompleted`, Gorodki: no stars stored for the figure yet). Always false for a fail. */
  firstCompletion: boolean;
  /** Stars of THIS run (0..3), for a game with stars. */
  stars?: number;
  metrics: GameplayMetrics;
}

/** The player left a level unfinished (SoliPix onExitToMenu). */
export type GameplayLevelExit = GameplayLevelRef;

/** Gameplay → Core. Core implements it; the gameplay calls it. */
export interface GameplayEvents {
  /** Loaded and interactive (SoliPix services.loadingReady; Gorodki: startGame resolved). */
  ready(): void;
  levelStart(event: GameplayLevelStart): void;
  levelEnd(result: GameplayLevelResult): void;
  /** Optional for the gameplay: a game without an exit path (Gorodki: the picker opens over the level) never calls it. */
  levelExit(event: GameplayLevelExit): void;
}

/** One level on the map — structurally the Ready UI `LevelMapLevel` without Trail Arrow's `hard`. */
export interface GameplayLevelProgress {
  /** 1-based level number. */
  index: number;
  /** Best stars so far; 0 / absent = not completed. */
  stars?: number;
}

/** The gameplay's own progress, read on demand (both hosts rebuild the map from it; the save format stays the gameplay's). */
export interface GameplayProgress {
  levels: GameplayLevelProgress[];
  /** The level the player is on (SoliPix progressLevelId; Gorodki the loaded figure). How it locks the others is `progression.mode` of the profile. */
  currentLevel: number;
}

/** Why the gameplay is paused: a blocking Core window (Gorodki `blocked()`) or an ad (SoliPix audio.pauseForAd). */
export type GameplayPauseReason = 'ui' | 'ad';

/** Core → gameplay. The gameplay implements them. */
export interface GameplayCommands {
  /** Opens a level by its 1-based number (SoliPix actions.playLevel, Gorodki load(level - 1)). The gameplay re-checks its own locks. */
  startLevel(level: number): void;
  /** Restarts the current level (both games: Settings → restart). */
  restart(): void;
  setPaused(paused: boolean, reason: GameplayPauseReason): void;
  setSound(enabled: boolean): void;
  /** Only a game with music (SoliPix actions.setMusic); Gorodki has sound effects only. */
  setMusic?(enabled: boolean): void;
  /** The game's own "next" rule when it is not `startLevel(level + 1)` (Gorodki wraps to the first figure). */
  next?(): void;
}

/**
 * Who drives the frame that updates Core's overlay: the gameplay's own loop (Gorodki: the Three.js
 * animation loop calls host.frame(ms)) or the host / Core (SoliPix: the DOM gameplay has no loop).
 */
export type GameplayFrameOwner = 'core' | 'gameplay';

/**
 * How gameplay input stays apart from Core UI input: 'layer' — the overlay hit layer alone (SoliPix: card
 * drags reach the DOM outside the UI regions); 'query' — the gameplay listens on its own and asks Core
 * (Gorodki: blocked() + isUiAt(x, y), see `GameplayInputQueries`).
 */
export type GameplayInputMode = 'layer' | 'query';

export interface GameplayIntegrationModes {
  frame: GameplayFrameOwner;
  input: GameplayInputMode;
}

/** What Core answers a gameplay in the 'query' input mode (Gorodki's `blocked` / `isUiAt` hooks). */
export interface GameplayInputQueries {
  /** A Core window blocks the game (no throws, no simulation step). */
  isBlocking(): boolean;
  /** Viewport CSS px. */
  isUiAt(x: number, y: number): boolean;
}

/** Everything the gameplay exposes to Core under Contract V1. */
export interface GameplayContract extends GameplayCommands {
  readonly modes: GameplayIntegrationModes;
  getProgress(): GameplayProgress;
}
