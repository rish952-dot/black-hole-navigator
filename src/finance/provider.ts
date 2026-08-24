/**
 * Settlement provider boundary. The farm/finance core NEVER talks to a real
 * money rail directly; it goes through this interface. The default
 * implementation is an in-memory sandbox (paper money). A real provider can
 * be plugged in later without touching the Farm or Mesh.
 */

export interface SettlementTransferRequest {
  settlementId: string;
  amountMinor: number;
  /** Logical destination (e.g. wallet, bank ref). Never logged with secrets. */
  destination: string;
  asset: string;
  idempotencyKey: string;
}

export interface SettlementTransferResult {
  reference: string;
  status: "SETTLED";
}

/**
 * Implementations must be idempotent on idempotencyKey and must throw on
 * failure (the finance core then performs a compensating release).
 */
export interface SettlementProvider {
  readonly id: string;
  readonly mode: "sandbox" | "live";
  transfer(request: SettlementTransferRequest): Promise<SettlementTransferResult>;
}

/** Paper-money provider: records transfers in memory, never moves real funds. */
export class SandboxSettlementProvider implements SettlementProvider {
  readonly id = "sandbox";
  readonly mode = "sandbox" as const;
  private transfers = new Map<string, SettlementTransferResult>();

  transfer(request: SettlementTransferRequest): Promise<SettlementTransferResult> {
    const existing = this.transfers.get(request.idempotencyKey);
    if (existing) return Promise.resolve(existing);

    const result: SettlementTransferResult = {
      reference: `sandbox:${request.idempotencyKey}`,
      status: "SETTLED",
    };
    this.transfers.set(request.idempotencyKey, result);
    return Promise.resolve(result);
  }

  /** Test/audit helper: number of distinct sandbox transfers performed. */
  get transferCount(): number {
    return this.transfers.size;
  }
}

/**
 * Stub for a future authorized provider. It fails closed until real
 * credentials and a provider implementation are wired in behind the
 * FINANCE_LIVE_ENABLED flag.
 */
export class UnconfiguredLiveProvider implements SettlementProvider {
  readonly id = "live-unconfigured";
  readonly mode = "live" as const;

  transfer(_request: SettlementTransferRequest): Promise<SettlementTransferResult> {
    return Promise.reject(
      new Error("Live settlement provider is not configured; refusing to move funds"),
    );
  }
}
