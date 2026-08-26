/**
 * Crypto settlement lifecycle: proposals require explicit operator approval
 * before on-chain execution. Execution goes through the
 * CryptoSettlementProvider boundary; any provider failure triggers a
 * compensating release (rollback) journal entry.
 */

import { LimitExceededError, SettlementStateError } from "./errors";
import type { CryptoLedger } from "./crypto-ledger";
import type { CryptoSettlementProvider } from "./crypto-provider";
import type { CryptoSpendGate } from "./crypto-spend-gate";
import { assertEvmAddress, requireAsset, type AssetKey } from "./crypto";

export type CryptoSettlementStatus = "PROPOSED" | "APPROVED" | "REJECTED" | "SETTLED" | "FAILED";

export interface CryptoSettlementRecord {
  id: string;
  createdAt: string;
  asset: AssetKey;
  /** Base units as decimal string (bigint-safe over the wire). */
  amountBase: string;
  /** EVM destination address; redacted from aggregate telemetry. */
  toAddress: string;
  reason: string;
  agentId?: string;
  status: CryptoSettlementStatus;
  approvedBy?: string;
  approvedAt?: string;
  settledAt?: string;
  txHash?: string;
  failureReason?: string;
}

export interface ProposeCryptoSettlementInput {
  asset: AssetKey;
  amountBase: bigint;
  toAddress: string;
  reason: string;
  agentId?: string;
  idempotencyKey?: string;
}

export class CryptoSettlementEngine {
  private settlements = new Map<string, CryptoSettlementRecord>();
  private byIdempotencyKey = new Map<string, CryptoSettlementRecord>();
  private counter = 0;

  constructor(
    private readonly ledger: CryptoLedger,
    private readonly provider: CryptoSettlementProvider,
    private readonly spendGate: CryptoSpendGate,
  ) {}

  /** Create a proposal. Reserves equity via a balanced hold entry. */
  propose(input: ProposeCryptoSettlementInput, now = new Date()): CryptoSettlementRecord {
    requireAsset(input.asset);
    assertEvmAddress(input.toAddress);
    if (input.amountBase <= 0n) {
      throw new SettlementStateError("Settlement amount must be positive base units");
    }
    if (!input.reason.trim()) throw new SettlementStateError("Settlement reason is required");

    if (input.idempotencyKey) {
      const existing = this.byIdempotencyKey.get(input.idempotencyKey);
      if (existing) return { ...existing };
    }

    const id = `fin-crypto-settle-${this.counter++}`;
    const record: CryptoSettlementRecord = {
      id,
      createdAt: now.toISOString(),
      asset: input.asset,
      amountBase: input.amountBase.toString(),
      toAddress: input.toAddress.trim(),
      reason: input.reason,
      agentId: input.agentId,
      status: "PROPOSED",
    };

    // Hold: recognize the liability and reduce distributable equity. Custody
    // is untouched until the on-chain transfer actually confirms.
    this.ledger.post({
      kind: "crypto_settlement_hold",
      asset: input.asset,
      lines: [
        { account: "crypto:equity:owner-capital", amount: input.amountBase },
        { account: "crypto:payable:settlements", amount: -input.amountBase },
      ],
      provenance: { settlementId: id, agentId: input.agentId, note: input.reason },
      idempotencyKey: input.idempotencyKey ? `hold:${input.idempotencyKey}` : undefined,
      timestamp: now.toISOString(),
    });

    this.settlements.set(id, record);
    if (input.idempotencyKey) this.byIdempotencyKey.set(input.idempotencyKey, record);
    return { ...record };
  }

  approve(id: string, approverId: string, now = new Date()): CryptoSettlementRecord {
    const record = this.require(id);
    if (!approverId.trim()) throw new SettlementStateError("Approver identity is required");
    if (record.status !== "PROPOSED") {
      throw new SettlementStateError(`Cannot approve crypto settlement in ${record.status} state`);
    }
    record.status = "APPROVED";
    record.approvedBy = approverId;
    record.approvedAt = now.toISOString();
    return { ...record };
  }

  reject(id: string, now = new Date()): CryptoSettlementRecord {
    const record = this.require(id);
    if (record.status !== "PROPOSED") {
      throw new SettlementStateError(`Cannot reject crypto settlement in ${record.status} state`);
    }
    record.status = "REJECTED";
    this.release(record, now, "rejected");
    return { ...record };
  }

  /**
   * Execute an approved settlement on-chain through the provider. On
   * provider failure the hold is released (compensating entry) and the
   * settlement is marked FAILED.
   */
  async execute(id: string, now = new Date()): Promise<CryptoSettlementRecord> {
    const record = this.require(id);
    if (record.status !== "APPROVED") {
      throw new SettlementStateError("Only approved crypto settlements can be executed");
    }

    const amountBase = BigInt(record.amountBase);
    this.spendGate.assertAllowed(record.asset, record.agentId, amountBase, now.getTime());

    try {
      const result = await this.provider.transfer({
        settlementId: record.id,
        asset: record.asset,
        amountBase,
        toAddress: record.toAddress,
        idempotencyKey: `crypto-settlement:${record.id}`,
      });
      this.spendGate.commit(record.asset, record.agentId, amountBase, now.getTime());

      // Payout: clear the liability against custody, anchored to the tx hash.
      this.ledger.post({
        kind: "crypto_settlement_payout",
        asset: record.asset,
        lines: [
          { account: "crypto:payable:settlements", amount: amountBase },
          { account: "crypto:custody", amount: -amountBase },
        ],
        provenance: {
          settlementId: record.id,
          agentId: record.agentId,
          txHash: result.txHash,
          note: "on-chain transfer confirmed",
        },
        timestamp: now.toISOString(),
      });

      record.status = "SETTLED";
      record.settledAt = now.toISOString();
      record.txHash = result.txHash;
      return { ...record };
    } catch (error) {
      if (error instanceof LimitExceededError || error instanceof SettlementStateError) throw error;
      this.release(record, now, error instanceof Error ? error.message : "provider failure");
      record.status = "FAILED";
      record.failureReason = error instanceof Error ? error.message : "provider failure";
      return { ...record };
    }
  }

  get(id: string): CryptoSettlementRecord | undefined {
    const record = this.settlements.get(id);
    return record ? { ...record } : undefined;
  }

  list(): CryptoSettlementRecord[] {
    return [...this.settlements.values()].map((record) => ({ ...record }));
  }

  private release(record: CryptoSettlementRecord, now: Date, note: string): void {
    this.ledger.post({
      kind: "crypto_settlement_release",
      asset: record.asset,
      lines: [
        { account: "crypto:payable:settlements", amount: BigInt(record.amountBase) },
        { account: "crypto:equity:owner-capital", amount: -BigInt(record.amountBase) },
      ],
      provenance: { settlementId: record.id, agentId: record.agentId, note },
      timestamp: now.toISOString(),
    });
  }

  private require(id: string): CryptoSettlementRecord {
    const record = this.settlements.get(id);
    if (!record) throw new SettlementStateError(`Unknown crypto settlement ${id}`);
    return record;
  }
}
