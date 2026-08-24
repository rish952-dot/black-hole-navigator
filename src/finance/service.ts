/**
 * FinanceService — the single entry point of the internal/private finance
 * subsystem. The Farm and Mesh interact with finance only through this
 * facade (and its read-only API surface), never with the ledger, settlement
 * engine, or provider directly.
 *
 * Security posture:
 *  - fail-closed: every method requires the subsystem to be enabled,
 *  - every method requires an authenticated Principal with a sufficient role,
 *  - agents may record economic events but may never approve/execute
 *    settlements or read sensitive configuration,
 *  - nothing here ever returns provider credentials or raw destinations
 *    through the telemetry surface.
 */

import type { AccountId } from "./accounts";
import { hasAnyRole, hasRole, type FinanceRole, type Principal } from "./auth";
import type { FinanceConfig } from "./config";
import { publicFinanceConfig } from "./config";
import { FinanceDisabledError, UnauthorizedFinanceOperationError } from "./errors";
import { FinancialLedger, type JournalEntry, type JournalProvenance, type PostingKind } from "./ledger";
import { fromMinorUnits, toMinorUnits } from "./money";
import { detectAnomalies, reconcile, type Anomaly, type ReconciliationReport } from "./reconciliation";
import { SettlementEngine, type ProposeSettlementInput, type SettlementRecord } from "./settlement";
import { SpendGate } from "./spend-gate";
import type { SettlementProvider } from "./provider";
import { SandboxSettlementProvider, UnconfiguredLiveProvider } from "./provider";

export interface RecordEarningsInput {
  agentId: string;
  amount: number; // decimal units, converted to minor units internally
  taskId?: string;
  jobId?: string;
  opportunityId?: string;
  generation?: number;
  note?: string;
  idempotencyKey?: string;
}

export interface RecordCostInput {
  agentId: string;
  amount: number;
  category?: "compute" | "api" | "tool" | "fees" | "penalties";
  taskId?: string;
  jobId?: string;
  generation?: number;
  note?: string;
  idempotencyKey?: string;
}

/** Aggregate-only financial state. Safe for authorized Mesh/Admin views. */
export interface FinanceTelemetry {
  enabled: boolean;
  mode: "sandbox" | "live";
  revenue: number;
  costs: number;
  profitLoss: number;
  pendingSettlements: { count: number; total: number };
  ledgerHealth: "ok" | "degraded";
  riskState: "normal" | "elevated" | "critical";
  anomalyCounts: Record<"info" | "warning" | "critical", number>;
  spendToday: number;
}

const WRITE_ROLES: FinanceRole[] = ["system", "operator"];
const APPROVE_ROLES: FinanceRole[] = ["operator"];
const READ_DETAIL_ROLES: FinanceRole[] = ["system", "operator", "auditor"];
const TELEMETRY_ROLES: FinanceRole[] = ["system", "operator", "auditor", "viewer"];

export class FinanceService {
  readonly ledger: FinancialLedger;
  private readonly settlements: SettlementEngine;
  private readonly spendGate: SpendGate;
  private readonly provider: SettlementProvider;
  private readonly config: FinanceConfig;

  constructor(config: FinanceConfig, provider?: SettlementProvider) {
    this.config = config;
    this.ledger = new FinancialLedger();
    this.spendGate = new SpendGate(config.limits);
    this.provider =
      provider ?? (config.mode === "live" ? new UnconfiguredLiveProvider() : new SandboxSettlementProvider());
    this.settlements = new SettlementEngine(this.ledger, this.provider, this.spendGate);
  }

  // ---- write surface ------------------------------------------------------

  /** Record task-payout revenue earned by an agent (credit revenue, debit receivable→cash). */
  recordEarnings(principal: Principal, input: RecordEarningsInput): JournalEntry {
    this.assertEnabled();
    this.requireRole(principal, WRITE_ROLES);
    const amountMinor = toMinorUnits(input.amount);
    this.assertPositive(amountMinor);

    return this.ledger.post({
      kind: "revenue",
      lines: [
        { account: "cash:operating", amount: amountMinor },
        { account: "revenue:task-payouts", amount: -amountMinor },
      ],
      provenance: this.provenance(input, input.agentId),
      idempotencyKey: input.idempotencyKey,
    });
  }

  /** Record a cost incurred by an agent (debit expense, credit cash). Gated by spend limits. */
  recordCost(principal: Principal, input: RecordCostInput): JournalEntry {
    this.assertEnabled();
    this.requireRole(principal, WRITE_ROLES);
    const amountMinor = toMinorUnits(input.amount);
    this.assertPositive(amountMinor);
    this.spendGate.assertAllowed(input.agentId, amountMinor);
    this.spendGate.commit(input.agentId, amountMinor);

    const expenseAccount: AccountId =
      input.category === "api"
        ? "expense:api"
        : input.category === "tool"
          ? "expense:tool"
          : input.category === "fees"
            ? "expense:fees"
            : input.category === "penalties"
              ? "expense:penalties"
              : "expense:compute";

    return this.ledger.post({
      kind: input.category === "penalties" ? "penalty" : "cost",
      lines: [
        { account: expenseAccount, amount: amountMinor },
        { account: "cash:operating", amount: -amountMinor },
      ],
      provenance: this.provenance(input, input.agentId),
      idempotencyKey: input.idempotencyKey,
    });
  }

  /** Record a reward paid to an agent (debit expense-equivalent revenue contra, credit cash). */
  recordReward(principal: Principal, input: RecordEarningsInput): JournalEntry {
    this.assertEnabled();
    this.requireRole(principal, WRITE_ROLES);
    const amountMinor = toMinorUnits(input.amount);
    this.assertPositive(amountMinor);

    return this.ledger.post({
      kind: "reward",
      lines: [
        { account: "cash:operating", amount: amountMinor },
        { account: "revenue:rewards", amount: -amountMinor },
      ],
      provenance: this.provenance(input, input.agentId),
      idempotencyKey: input.idempotencyKey,
    });
  }

  /** Inject owner capital (debit cash, credit equity). */
  recordCapitalInjection(principal: Principal, amount: number, note?: string, idempotencyKey?: string): JournalEntry {
    this.assertEnabled();
    this.requireRole(principal, ["operator"]);
    const amountMinor = toMinorUnits(amount);
    this.assertPositive(amountMinor);

    return this.ledger.post({
      kind: "capital",
      lines: [
        { account: "cash:operating", amount: amountMinor },
        { account: "equity:owner-capital", amount: -amountMinor },
      ],
      provenance: { note, source: "owner" },
      idempotencyKey,
    });
  }

  // ---- settlement surface -------------------------------------------------

  proposeSettlement(principal: Principal, input: ProposeSettlementInput): SettlementRecord {
    this.assertEnabled();
    this.requireRole(principal, WRITE_ROLES);
    return this.settlements.propose(input);
  }

  approveSettlement(principal: Principal, id: string): SettlementRecord {
    this.assertEnabled();
    this.requireRole(principal, APPROVE_ROLES);
    return this.settlements.approve(id, principal.id);
  }

  rejectSettlement(principal: Principal, id: string): SettlementRecord {
    this.assertEnabled();
    this.requireRole(principal, APPROVE_ROLES);
    return this.settlements.reject(id);
  }

  async executeSettlement(principal: Principal, id: string): Promise<SettlementRecord> {
    this.assertEnabled();
    this.requireRole(principal, APPROVE_ROLES);
    return this.settlements.execute(id);
  }

  // ---- read surface --------------------------------------------------------

  /** Full ledger view: detail roles only, never exposed to the Mesh UI. */
  entries(principal: Principal): JournalEntry[] {
    this.assertEnabled();
    this.requireRole(principal, READ_DETAIL_ROLES);
    return this.ledger.all();
  }

  listSettlements(principal: Principal): SettlementRecord[] {
    this.assertEnabled();
    this.requireRole(principal, READ_DETAIL_ROLES);
    return this.settlements.list();
  }

  reconcileNow(principal: Principal): ReconciliationReport {
    this.assertEnabled();
    this.requireRole(principal, READ_DETAIL_ROLES);
    return reconcile(this.ledger);
  }

  anomalies(principal: Principal): Anomaly[] {
    this.assertEnabled();
    this.requireRole(principal, READ_DETAIL_ROLES);
    return detectAnomalies(this.ledger);
  }

  /**
   * Aggregate telemetry safe for authorized Mesh/Admin widgets. Contains no
   * transaction detail, no destinations, no credentials.
   */
  telemetry(principal: Principal): FinanceTelemetry {
    this.requireRole(principal, TELEMETRY_ROLES);
    if (!this.config.enabled) {
      return {
        enabled: false,
        mode: this.config.mode,
        revenue: 0,
        costs: 0,
        profitLoss: 0,
        pendingSettlements: { count: 0, total: 0 },
        ledgerHealth: "degraded",
        riskState: "normal",
        anomalyCounts: { info: 0, warning: 0, critical: 0 },
        spendToday: 0,
      };
    }

    const revenue = -this.ledger.balanceOf("revenue:task-payouts") - this.ledger.balanceOf("revenue:rewards");
    const costs =
      this.ledger.balanceOf("expense:compute") +
      this.ledger.balanceOf("expense:api") +
      this.ledger.balanceOf("expense:tool") +
      this.ledger.balanceOf("expense:fees") +
      this.ledger.balanceOf("expense:penalties");
    const report = reconcile(this.ledger);
    const anomalies = detectAnomalies(this.ledger);
    const anomalyCounts = {
      info: anomalies.filter((a) => a.severity === "info").length,
      warning: anomalies.filter((a) => a.severity === "warning").length,
      critical: anomalies.filter((a) => a.severity === "critical").length,
    };
    const pending = this.settlements.list().filter((s) => s.status === "PROPOSED" || s.status === "APPROVED");
    const spend = this.spendGate.snapshot();

    return {
      enabled: true,
      mode: this.config.mode,
      revenue: fromMinorUnits(revenue),
      costs: fromMinorUnits(costs),
      profitLoss: fromMinorUnits(revenue - costs),
      pendingSettlements: {
        count: pending.length,
        total: fromMinorUnits(pending.reduce((sum, s) => sum + s.amountMinor, 0)),
      },
      ledgerHealth: report.ok ? "ok" : "degraded",
      riskState: anomalyCounts.critical > 0 ? "critical" : anomalyCounts.warning > 0 ? "elevated" : "normal",
      anomalyCounts,
      spendToday: fromMinorUnits(spend.spentTodayTotal),
    };
  }

  /** Redacted config snapshot: never contains credentials. */
  publicConfig(principal: Principal) {
    this.requireRole(principal, TELEMETRY_ROLES);
    return publicFinanceConfig(this.config);
  }

  // ---- internals -----------------------------------------------------------

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

  private assertPositive(amountMinor: number): void {
    if (amountMinor <= 0) throw new UnauthorizedFinanceOperationError("Amount must be positive");
  }

  private provenance(
    input: { taskId?: string; jobId?: string; opportunityId?: string; generation?: number; note?: string },
    agentId: string,
  ): JournalProvenance {
    return {
      agentId,
      taskId: input.taskId,
      jobId: input.jobId,
      opportunityId: input.opportunityId,
      generation: input.generation,
      note: input.note,
      source: "farm",
    };
  }
}

/** Type guard for host code that wants to check approval authority explicitly. */
export function canApproveSettlements(principal: Principal): boolean {
  return hasRole(principal, "operator");
}

export type { PostingKind };
