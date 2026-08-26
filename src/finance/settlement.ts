/**
 * Settlement lifecycle. Proposals require explicit operator approval before
 * execution; execution goes through the SettlementProvider boundary and any
 * provider failure triggers a compensating release (rollback) journal entry.
 */

import { SettlementStateError, LimitExceededError } from "./errors";
import type { FinancialLedger } from "./ledger";
import type { SettlementProvider } from "./provider";
import type { SpendGate } from "./spend-gate";

export type SettlementStatus = "PROPOSED" | "APPROVED" | "REJECTED" | "SETTLED" | "FAILED";

export interface SettlementRecord {
  id: string;
  createdAt: string;
  amountMinor: number;
  asset: string;
  /** Logical destination, redacted from aggregate telemetry. */
  destination: string;
  reason: string;
  agentId?: string;
  status: SettlementStatus;
  approvedBy?: string;
  approvedAt?: string;
  settledAt?: string;
  providerReference?: string;
  failureReason?: string;
}

export interface ProposeSettlementInput {
  amountMinor: number;
  asset: string;
  destination: string;
  reason: string;
  agentId?: string;
  idempotencyKey?: string;
}

export class SettlementEngine {
  private settlements = new Map<string, SettlementRecord>();
  private byIdempotencyKey = new Map<string, SettlementRecord>();
  private counter = 0;

  constructor(
    private readonly ledger: FinancialLedger,
    private readonly provider: SettlementProvider,
    private readonly spendGate: SpendGate,
  ) {}

  /** Create a proposal. Holds funds via a balanced journal entry. */
  propose(input: ProposeSettlementInput, now = new Date()): SettlementRecord {
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new SettlementStateError("Settlement amount must be a positive safe integer (minor units)");
    }
    if (!input.destination.trim()) throw new SettlementStateError("Settlement destination is required");

    if (input.idempotencyKey) {
      const existing = this.byIdempotencyKey.get(input.idempotencyKey);
      if (existing) return { ...existing };
    }

    const id = `fin-settle-${this.counter++}`;
    const record: SettlementRecord = {
      id,
      createdAt: now.toISOString(),
      amountMinor: input.amountMinor,
      asset: input.asset,
      destination: input.destination,
      reason: input.reason,
      agentId: input.agentId,
      status: "PROPOSED",
    };

    // Hold: recognize the liability and reduce distributable equity. Cash is
    // untouched until the provider actually settles.
    this.ledger.post({
      kind: "settlement_hold",
      lines: [
        { account: "equity:owner-capital", amount: input.amountMinor },
        { account: "payable:settlements", amount: -input.amountMinor },
      ],
      provenance: { settlementId: id, agentId: input.agentId, note: input.reason },
      idempotencyKey: input.idempotencyKey ? `hold:${input.idempotencyKey}` : undefined,
      timestamp: now.toISOString(),
    });

    this.settlements.set(id, record);
    if (input.idempotencyKey) this.byIdempotencyKey.set(input.idempotencyKey, record);
    return { ...record };
  }

  approve(id: string, approverId: string, now = new Date()): SettlementRecord {
    const record = this.require(id);
    if (!approverId.trim()) throw new SettlementStateError("Approver identity is required");
    if (record.status !== "PROPOSED") {
      throw new SettlementStateError(`Cannot approve settlement in ${record.status} state`);
    }
    record.status = "APPROVED";
    record.approvedBy = approverId;
    record.approvedAt = now.toISOString();
    return { ...record };
  }

  reject(id: string, now = new Date()): SettlementRecord {
    const record = this.require(id);
    if (record.status !== "PROPOSED") {
      throw new SettlementStateError(`Cannot reject settlement in ${record.status} state`);
    }
    record.status = "REJECTED";
    this.release(record, now, "rejected");
    return { ...record };
  }

  /**
   * Execute an approved settlement through the provider. On provider failure
   * the hold is released (compensating entry) so funds return to operating
   * cash and the settlement is marked FAILED.
   */
  async execute(id: string, now = new Date()): Promise<SettlementRecord> {
    const record = this.require(id);
    if (record.status !== "APPROVED") {
      throw new SettlementStateError("Only approved settlements can be executed");
    }

    this.spendGate.assertAllowed(record.agentId, record.amountMinor, now.getTime());

    try {
      const result = await this.provider.transfer({
        settlementId: record.id,
        amountMinor: record.amountMinor,
        destination: record.destination,
        asset: record.asset,
        idempotencyKey: `settlement:${record.id}`,
      });
      this.spendGate.commit(record.agentId, record.amountMinor, now.getTime());

      // Payout: clear the liability against operating cash.
      this.ledger.post({
        kind: "settlement_payout",
        lines: [
          { account: "payable:settlements", amount: record.amountMinor },
          { account: "cash:operating", amount: -record.amountMinor },
        ],
        provenance: { settlementId: record.id, agentId: record.agentId, note: "provider settled" },
        timestamp: now.toISOString(),
      });

      record.status = "SETTLED";
      record.settledAt = now.toISOString();
      record.providerReference = result.reference;
      return { ...record };
    } catch (error) {
      if (error instanceof LimitExceededError || error instanceof SettlementStateError) throw error;
      this.release(record, now, error instanceof Error ? error.message : "provider failure");
      record.status = "FAILED";
      record.failureReason = error instanceof Error ? error.message : "provider failure";
      return { ...record };
    }
  }

  get(id: string): SettlementRecord | undefined {
    const record = this.settlements.get(id);
    return record ? { ...record } : undefined;
  }

  list(): SettlementRecord[] {
    return [...this.settlements.values()].map((record) => ({ ...record }));
  }

  pendingTotalMinor(): number {
    let total = 0;
    for (const record of this.settlements.values()) {
      if (record.status === "PROPOSED" || record.status === "APPROVED") total += record.amountMinor;
    }
    return total;
  }

  private release(record: SettlementRecord, now: Date, note: string): void {
    this.ledger.post({
      kind: "settlement_release",
      lines: [
        { account: "payable:settlements", amount: record.amountMinor },
        { account: "equity:owner-capital", amount: -record.amountMinor },
      ],
      provenance: { settlementId: record.id, agentId: record.agentId, note },
      timestamp: now.toISOString(),
    });
  }

  private require(id: string): SettlementRecord {
    const record = this.settlements.get(id);
    if (!record) throw new SettlementStateError(`Unknown settlement ${id}`);
    return record;
  }
}
