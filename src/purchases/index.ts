// PurchaseRuntime v0.6 — the platform-independent real-money purchase pipeline (root entry `game-core`).
export { PurchaseRuntime } from './PurchaseRuntime';
export { createGrantedPurchaseStore, DEFAULT_GRANTED_PURCHASE_CAP } from './grantedStore';
export type { GrantedPurchaseStoreOptions, MemoryGrantedPurchaseStore } from './grantedStore';
export type {
  PlatformPurchase,
  PlatformPurchaseStatus,
  PlatformPurchaseResult,
  RestoreGrantPolicy,
  PaymentsAdapter,
  GrantedPurchaseStore,
  PurchaseGrantContext,
  PurchaseErrorReason,
  PurchaseEvent,
  PurchaseEventType,
  PurchaseEventHandler,
  PurchaseErrorPhase,
  PurchaseErrorContext,
  PurchaseCallbackErrorHandler,
  PurchaseRuntimeOptions,
  PurchaseStatus,
  PurchaseResult,
  RestoredPurchase,
  RestoreResult,
  PurchasePending,
  PurchaseRuntimeStats
} from './types';
