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
