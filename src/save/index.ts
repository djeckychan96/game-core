// SaveGate V1 (root entry `game-core`): the load-before-write gate over PlatformStorage.
export { SaveGate } from './SaveGate';
export type {
  SaveGatePhase,
  SaveReadStatus,
  SaveGroupRead,
  SaveLoadResult,
  SaveWriteReason,
  SaveWriteResult,
  SaveGateSnapshot,
  SaveGateOptions
} from './SaveGate';
