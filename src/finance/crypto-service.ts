/**
 * CryptoFinanceService — single entry point for the cryptocurrency side of
 * the finance subsystem. Same security posture as FinanceService:
 * fail-closed feature flag, role-gated every method, agents may record but
 * never approve/execute, and nothing sensitive (addresses, keys, tx detail)
 * leaves through the aggregate telemetry surface.
 */

import type { Principal, FinanceRole } from "./auth";
import { hasAnyRole } from "./auth";
import { FinanceDisabledError, UnauthorizedFinanceOperationError } from "./errors";
import { formatUnits, parseUnits, requireAsset, type AssetKey, type CryptoAsset } from "./crypto";
import type { CryptoConfig } from "./crypto-config";
import { publicCryptoConfig, type CryptoPublicConfig } from "./crypto-config";
import { CryptoLedger, type CryptoJournalEntry, type CryptoJournalProvenance } from "./crypto-ledger";
import {
  CryptoSettlementEngine,
  type CryptoSettlementRecord,
  type ProposeCryptoSettlementInput,
} from "./crypto-settlement";
import { CryptoSpendGate } from "./crypto-spend-gate";
import type { CryptoSettlementProvider } from "./crypto-provider";
import { DisabledSandboxCryptoProvider, EvmCryptoProvider } from "./crypto-provider";
import {
  detectCryptoAnomalies,
  reconcileCrypto,
  type CryptoAnomaly,
  type CryptoReconciliationReport,
} from "./crypto-reconciliation";

export interface RecordCryptoEarningsInput {
  agentId: string;
  asset: AssetKey;
  /** Human decimal string, e.g. "0.25" ETH or "12.5" USDC. */
  amount: string;
  taskId?: string;
  jobId?: string;
  opportunityId?: string;
  generation?: number;
  note?: string;
  idempotencyKey?: string;
}

export interface RecordCryptoCostInput extends RecordCryptoEarningsInput {
  category?: "compute" | "api" | "fees" | "gas";
}

/** Aggregate-only crypto state. Safe for authorized Mesh/Admin views. */
export interface CryptoAssetTelemetry {
  asset: AssetKey;
  symbol: string;
  chain: string;
  custody: string;
  revenue: string;
  costs: string;
  profitLoss: string;
  pendingSettlements: { count: number; total: string };
  spendToday: string;
}

export interface CryptoTelemetry {
  enabled: boolean;
  mode: "sandbox" | "live";
  assets: CryptoAssetTelemetry[];
  ledgerHealth: "ok" | "degraded";
  riskState: "normal" | "elevated" | "critical";
  anomalyCounts: Record<"info" | "warning" | "critical", number>;
}

const WRITE_ROLES: FinanceRole[] = ["system", "operator"];
const APPROVE_ROLES: FinanceRole[] = ["operator"];
const READ_DETAIL_ROLES: FinanceRole[] = ["system", "operator", "auditor"];
const TELEMETRY_ROLES: FinanceRole[] = ["system", "operator", "auditor", "viewer"];

export class CryptoFinanceService {
  readonly ledger: CryptoLedger;
  private readonly settlements: CryptoSettlementEngine;
  private readonly spendGate: CryptoSpendGate;
  private readonly provider: CryptoSettlementProvider;
  private readonly config: CryptoConfig;

  constructor(config: CryptoConfig, provider?: CryptoSettlementProvider) {
    this.config = config;
    this.ledger = new CryptoLedger();
    this.spendGate = new CryptoSpendGate(config.limits);
    this.provider =
      provider ??
      (config.mode === "live" && config.credentials
        ? new EvmCryptoProvider(config.credentials, config.enabledAssets.map((a) => requireAsset(a).chain))
        : new DisabledSandboxCryptoProvider());
    this.settlements = new CryptoSettlementEngine(this.ledger, this.provider, this.spendGate);
  }

  // ---- write surface ------------------------------------------------------

  recordEarnings(principal: Principal, input: RecordCryptoEarningsInput): CryptoJournalEntry {
    this.assertEnabled();
    this.requireRole(principal, WRITE_ROLES);
    const { asset, amountBase } = this.amountOf(input.asset, input.amount);

    return this.ledger.post({
      kind: "crypto_revenue",
      asset: input.asset,
      lines: [
        { account: "crypto:custody", amount: amountBase },
        { account: "crypto:revenue:task-payouts", amount: -amountBase },
      ],
      provenance: this.provenance(input, input.agentId, `earnings of ${formatUnits(amountBase, asset)} ${asset.symbol}`),
      idempotencyKey: input.idempotencyKey,
    });
  }

  recordReward(principal: Principal, input: RecordCryptoEarningsInput): CryptoJournalEntry {
    this.assertEnabled();
    this.requireRole(principal, WRITE_ROLES);
    const { asset, amountBase } = this.amountOf(input.asset, input.amount);

    return this.ledger.post({
      kind: "crypto_reward",
      asset: input.asset,
      lines: [
        { account: "crypto:custody", amount: amountBase },
        { account: "crypto:revenue:rewards", amount: -amountBase },
      ],
      provenance: this.provenance(input, input.agentId, `reward of ${formatUnits(amountBase, asset)} ${asset.symbol}`),
      idempotencyKey: input.idempotencyKey,
    });
  }

  /** Record a crypto cost incurred by an agent (gated by spend limits). */
  recordCost(principal: Principal, input: RecordCryptoCostInput): CryptoJournalEntry {
    this.assertEnabled();
    this.requireRole(principal, WRITE_ROLES);
    const { amountBase } = this.amountOf(input.asset, input.amount);
    this.spendGate.assertAllowed(input.asset, input.agentId, amountBase);
    this.spendGate.commit(input.asset, input.agentId, amountBase);

    const expenseAccount =
      input.category === "api"
        ? ("crypto:expense:api" as const)
        : input.category === "fees"
          ? ("crypto:expense:fees" as const)
          : input.category === "gas"
            ? ("crypto:expense:gas" as const)
            : ("crypto:expense:compute" as const);

    return this.ledger.post({
      kind: input.category === "gas" ? "crypto_gas" : "crypto_cost",
      asset: input.asset,
      lines: [
        { account: expenseAccount, amount: amountBase },
        { account: "crypto:custody", amount: -amountBase },
      ],
      provenance: this.provenance(input, input.agentId),
      idempotencyKey: input.idempotencyKey,
    });
  }

  /** Inject owner capital into custody (debit custody, credit equity). */
  recordCapitalInjection(
    principal: Principal,
    asset: AssetKey,
    amount: string,
    note?: string,
    idempotencyKey?: string,
  ): CryptoJournalEntry {
    this.assertEnabled();
    this.requireRole(principal, ["operator"]);
    const { amountBase } = this.amountOf(asset, amount);

    return this.ledger.post({
      kind: "crypto_capital",
      asset,
      lines: [
        { account: "crypto:custody", amount: amountBase },
        { account: "crypto:equity:owner-capital", amount: -amountBase },
      ],
      provenance: { note, source: "owner" },
      idempotencyKey,
    });
  }

  // ---- settlement surface -------------------------------------------------

  proposeSettlement(principal: Principal, input: ProposeCryptoSettlementInput): CryptoSettlementRecord {
    this.assertEnabled();
    this.requireRole(principal, WRITE_ROLES);
    return this.settlements.propose(input);
  }

  approveSettlement(principal: Principal, id: string): CryptoSettlementRecord {
    this.assertEnabled();
    this.requireRole(principal, APPROVE_ROLES);
    return this.settlements.approve(id, principal.id);
  }

  rejectSettlement(principal: Principal, id: string): CryptoSettlementRecord {
    this.assertEnabled();
    this.requireRole(principal, APPROVE_ROLES);
    return this.settlements.reject(id);
  }

  async executeSettlement(principal: Principal, id: string): Promise<CryptoSettlementRecord> {
    this.assertEnabled();
    this.requireRole(principal, APPROVE_ROLES);
    return this.settlements.execute(id);
  }

  // ---- read surface --------------------------------------------------------

  entries(principal: Principal): CryptoJournalEntry[] {
    this.assertEnabled();
    this.requireRole(principal, READ_DETAIL_ROLES);
    return this.ledger.all();
  }

  listSettlements(principal: Principal): CryptoSettlementRecord[] {
    this.assertEnabled();
    this.requireRole(principal, READ_DETAIL_ROLES);
    return this.settlements.list();
  }

  reconcileNow(principal: Principal): CryptoReconciliationReport {
    this.assertEnabled();
    this.requireRole(principal, READ_DETAIL_ROLES);
    return reconcileCrypto(this.ledger);
  }

  anomalies(principal: Principal): CryptoAnomaly[] {
    this.assertEnabled();
    this.requireRole(principal, READ_DETAIL_ROLES);
    return detectCryptoAnomalies(this.ledger);
  }

  /** Aggregate telemetry: no addresses, no tx hashes, no credentials. */
  telemetry(principal: Principal): CryptoTelemetry {
    this.requireRole(principal, TELEMETRY_ROLES);
    if (!this.config.enabled) {
      return {
        enabled: false,
        mode: this.config.mode,
        assets: [],
        ledgerHealth: "degraded",
        riskState: "normal",
        anomalyCounts: { info: 0, warning: 0, critical: 0 },
      };
    }

    const report = reconcileCrypto(this.ledger);
    const anomalies = detectCryptoAnomalies(this.ledger);
    const anomalyCounts = {
      info: anomalies.filter((a) => a.severity === "info").length,
      warning: anomalies.filter((a) => a.severity === "warning").length,
      critical: anomalies.filter((a) => a.severity === "critical").length,
    };
    const pending = this.settlements.list().filter((s) => s.status === "PROPOSED" || s.status === "APPROVED");
    const spendSnapshot = this.spendGate.snapshot();

    const assets: CryptoAssetTelemetry[] = this.config.enabledAssets.map((assetKey) => {
      const meta = requireAsset(assetKey);
      const custody = this.ledger.balanceOfAsset(assetKey, "crypto:custody");
      const revenue = -(
        this.ledger.balanceOfAsset(assetKey, "crypto:revenue:task-payouts") +
        this.ledger.balanceOfAsset(assetKey, "crypto:revenue:rewards")
      );
      const costs =
        this.ledger.balanceOfAsset(assetKey, "crypto:expense:compute") +
        this.ledger.balanceOfAsset(assetKey, "crypto:expense:api") +
        this.ledger.balanceOfAsset(assetKey, "crypto:expense:fees") +
        this.ledger.balanceOfAsset(assetKey, "crypto:expense:gas");
      const assetPending = pending.filter((s) => s.asset === assetKey);
      return {
        asset: assetKey,
        symbol: meta.symbol,
        chain: meta.chain,
        custody: formatUnits(custody, meta),
        revenue: formatUnits(revenue, meta),
        costs: formatUnits(costs, meta),
        profitLoss: formatUnits(revenue - costs, meta),
        pendingSettlements: {
          count: assetPending.length,
          total: formatUnits(assetPending.reduce((sum, s) => sum + BigInt(s.amountBase), 0n), meta),
        },
        spendToday: formatUnits(spendSnapshot[assetKey] ?? 0n, meta),
      };
    });

    return {
      enabled: true,
      mode: this.config.mode,
      assets,
      ledgerHealth: report.ok ? "ok" : "degraded",
      riskState: anomalyCounts.critical > 0 ? "critical" : anomalyCounts.warning > 0 ? "elevated" : "normal",
      anomalyCounts,
    };
  }

  /** Redacted config snapshot: never contains credentials or addresses. */
  publicConfig(principal: Principal): CryptoPublicConfig {
    this.requireRole(principal, TELEMETRY_ROLES);
    return publicCryptoConfig(this.config);
  }

  // ---- internals -----------------------------------------------------------

  private amountOf(asset: AssetKey, amount: string): { asset: CryptoAsset; amountBase: bigint } {
    const meta = requireAsset(asset);
    if (!this.config.enabledAssets.includes(asset)) {
      throw new UnauthorizedFinanceOperationError(`Asset ${asset} is not enabled on this crypto rail`);
    }
    const amountBase = parseUnits(amount, meta);
    if (amountBase <= 0n) throw new UnauthorizedFinanceOperationError("Amount must be positive");
    return { asset: meta, amountBase };
  }

  private assertEnabled(): void {
    if (!this.config.enabled) throw new FinanceDisabledError();
  }

  private requireRole(principal: Principal, roles: FinanceRole[]): void {
    if (!principal.authenticated) {
      throw new UnauthorizedFinanceOperationError("Authentication is required for finance operations");
    }
    if (!hasAnyRole(principal, roles)) {
      throw new UnauthorizedFinanceOperationError();
    }
  }

  private provenance(
    input: { taskId?: string; jobId?: string; opportunityId?: string; generation?: number; note?: string },
    agentId: string,
    fallbackNote?: string,
  ): CryptoJournalProvenance {
    return {
      agentId,
      taskId: input.taskId,
      jobId: input.jobId,
      opportunityId: input.opportunityId,
      generation: input.generation,
      note: input.note ?? fallbackNote,
      source: "farm",
    };
  }
}

/** Type guard for host code that wants to check approval authority explicitly. */
export { hasRole as cryptoHasRole } from "./auth";
