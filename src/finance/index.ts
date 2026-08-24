/**
 * Internal/private Financial Intelligence & Settlement subsystem.
 *
 * Boundary rules:
 *  - Everything here is internal. The UI may only consume the aggregate
 *    telemetry exposed through `createFinanceApi` + `FinanceTelemetryPanel`.
 *  - No financial mutation path is exposed to the Mesh visualization.
 *  - Disabled by default: set FINANCE_ENABLED=true to activate.
 */

export { FinanceService, canApproveSettlements, type FinanceTelemetry, type RecordEarningsInput, type RecordCostInput } from "./service";
export { createFinanceApi, type FinanceApi } from "./api";
export { FarmFinanceBridge } from "./farm-bridge";
export { FinancialLedger, type JournalEntry, type JournalLine, type JournalProvenance } from "./ledger";
export { SettlementEngine, type SettlementRecord, type SettlementStatus } from "./settlement";
export { SpendGate } from "./spend-gate";
export { SandboxSettlementProvider, UnconfiguredLiveProvider, type SettlementProvider } from "./provider";
export { reconcile, detectAnomalies, type ReconciliationReport, type Anomaly } from "./reconciliation";
export { resolveFinanceConfig, publicFinanceConfig, DEFAULT_FINANCE_LIMITS, type FinanceConfig, type FinanceMode } from "./config";
export { Principals, hasRole, hasAnyRole, type Principal, type FinanceRole } from "./auth";
export { toMinorUnits, fromMinorUnits, MINOR_UNIT_SCALE } from "./money";
export { ACCOUNT_IDS, accountType, type AccountId } from "./accounts";
export {
  FinanceError,
  FinanceDisabledError,
  FinanceConfigError,
  UnauthorizedFinanceOperationError,
  LedgerInvariantError,
  LimitExceededError,
  SettlementStateError,
} from "./errors";

// ---- Cryptocurrency rail (crypto-only; separate ledger, accounts, limits) --

export {
  CryptoFinanceService,
  type CryptoTelemetry,
  type CryptoAssetTelemetry,
  type RecordCryptoEarningsInput,
  type RecordCryptoCostInput,
} from "./crypto-service";
export { createCryptoFinanceApi, type CryptoFinanceApi } from "./crypto-api";
export { CryptoLedger, type CryptoJournalEntry, type CryptoJournalLine, type CryptoPostingKind } from "./crypto-ledger";
export { CryptoSettlementEngine, type CryptoSettlementRecord, type CryptoSettlementStatus } from "./crypto-settlement";
export { CryptoSpendGate, type CryptoLimits, type CryptoAssetLimits } from "./crypto-spend-gate";
export {
  DisabledSandboxCryptoProvider,
  EvmCryptoProvider,
  type CryptoSettlementProvider,
  type CryptoTransferRequest,
  type CryptoTransferResult,
} from "./crypto-provider";
export {
  reconcileCrypto,
  detectCryptoAnomalies,
  type CryptoReconciliationReport,
  type CryptoAnomaly,
} from "./crypto-reconciliation";
export { resolveCryptoConfig, publicCryptoConfig, type CryptoConfig, type CryptoMode } from "./crypto-config";
export {
  CRYPTO_ASSETS,
  CryptoAssetError,
  requireAsset,
  assertEvmAddress,
  parseUnits,
  formatUnits,
  type CryptoAsset,
  type AssetKey,
  type ChainId,
} from "./crypto";
export { CRYPTO_ACCOUNT_IDS, type CryptoAccountId } from "./crypto-accounts";
