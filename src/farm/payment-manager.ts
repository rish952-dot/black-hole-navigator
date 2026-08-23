export type PaymentMode = "paper" | "approval" | "live";

export type PaymentIntent = {
  id: string;
  agentId: string;
  amount: number;
  currency: string;
  reason: string;
  destination: string;
  createdAt: string;
};

export type LedgerEntry = PaymentIntent & {
  status: "PROPOSED" | "APPROVED" | "REJECTED" | "SETTLED";
  approvedBy?: string;
  settledAt?: string;
};

export class CentralPaymentManager {
  private readonly ledger = new Map<string, LedgerEntry>();

  constructor(
    readonly mode: PaymentMode = "paper",
    readonly dailyLimit = 100,
  ) {}

  propose(input: Omit<PaymentIntent, "id" | "createdAt">): LedgerEntry {
    if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error("Payment amount must be positive");
    if (!input.destination.trim()) throw new Error("Payment destination is required");
    const intent: LedgerEntry = {
      ...input,
      id: `pay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      status: "PROPOSED",
    };
    this.ledger.set(intent.id, intent);
    return { ...intent };
  }

  approve(id: string, approver: string): LedgerEntry {
    const entry = this.require(id);
    if (!approver.trim()) throw new Error("Approver is required");
    if (entry.status !== "PROPOSED") throw new Error(`Cannot approve payment in ${entry.status} state`);
    if (entry.amount > this.dailyLimit) throw new Error("Payment exceeds configured approval limit");
    entry.status = "APPROVED";
    entry.approvedBy = approver;
    return { ...entry };
  }

  settle(id: string): LedgerEntry {
    const entry = this.require(id);
    if (this.mode === "live") throw new Error("Live settlement adapter is intentionally not implemented in the core ledger");
    if (entry.status !== "APPROVED") throw new Error("Only approved payments can settle");
    entry.status = "SETTLED";
    entry.settledAt = new Date().toISOString();
    return { ...entry };
  }

  reject(id: string): LedgerEntry {
    const entry = this.require(id);
    if (entry.status !== "PROPOSED") throw new Error(`Cannot reject payment in ${entry.status} state`);
    entry.status = "REJECTED";
    return { ...entry };
  }

  list(): LedgerEntry[] {
    return [...this.ledger.values()].map((entry) => ({ ...entry }));
  }

  totals(): { proposed: number; approved: number; settled: number; rejected: number } {
    return [...this.ledger.values()].reduce((out, entry) => {
      if (entry.status === "PROPOSED") out.proposed += entry.amount;
      if (entry.status === "APPROVED") out.approved += entry.amount;
      if (entry.status === "SETTLED") out.settled += entry.amount;
      if (entry.status === "REJECTED") out.rejected += entry.amount;
      return out;
    }, { proposed: 0, approved: 0, settled: 0, rejected: 0 });
  }

  private require(id: string): LedgerEntry {
    const entry = this.ledger.get(id);
    if (!entry) throw new Error(`Unknown payment ${id}`);
    return entry;
  }
}
