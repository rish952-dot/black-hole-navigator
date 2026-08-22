import type { Transaction, TxType } from "./types";

/** In-memory double-entry-style ledger with a bounded tail for the UI. */
export class Ledger {
  private txs: Transaction[] = [];
  private counter = 0;
  private byAgent = new Map<string, { revenue: number; costs: number }>();
  private tailLimit = 4000;

  record(
    agentId: string,
    generation: number,
    type: TxType,
    amount: number,
    description: string,
    taskId?: string,
  ): Transaction {
    const tx: Transaction = {
      id: `tx-${this.counter++}`,
      agentId,
      taskId,
      generation,
      ts: Date.now(),
      type,
      amount: +amount.toFixed(2),
      description,
    };
    this.txs.push(tx);
    if (this.txs.length > this.tailLimit) this.txs.splice(0, this.txs.length - this.tailLimit);

    const acc = this.byAgent.get(agentId) ?? { revenue: 0, costs: 0 };
    if (amount >= 0) acc.revenue += amount;
    else acc.costs += -amount;
    this.byAgent.set(agentId, acc);
    return tx;
  }

  totals(agentId: string) {
    const acc = this.byAgent.get(agentId) ?? { revenue: 0, costs: 0 };
    return { ...acc, net: acc.revenue - acc.costs };
  }

  recent(limit = 100): Transaction[] {
    return this.txs.slice(-limit).reverse();
  }

  get size() {
    return this.counter;
  }
}
