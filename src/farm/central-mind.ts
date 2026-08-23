import { CentralPaymentManager, type LedgerEntry } from "./payment-manager";
import { HiveTopologicalMesh, type HiveDecision, type HiveNode, type HiveTask } from "./hive-topology";

export type CentralMindConfig = {
  topology?: "hierarchical" | "mesh" | "hierarchical-mesh" | "adaptive";
  consensus?: "raft" | "gossip" | "quorum" | "crdt";
  paymentMode?: "paper" | "approval" | "live";
  paymentDailyLimit?: number;
};

export class CentralMind {
  readonly mesh: HiveTopologicalMesh;
  readonly payments: CentralPaymentManager;

  constructor(config: CentralMindConfig = {}) {
    this.mesh = new HiveTopologicalMesh(config.topology ?? "hierarchical-mesh", config.consensus ?? "raft");
    this.payments = new CentralPaymentManager(config.paymentMode ?? "paper", config.paymentDailyLimit ?? 100);
  }

  addNode(node: HiveNode): void { this.mesh.register(node); }
  removeNode(nodeId: string): void { this.mesh.remove(nodeId); }
  route(task: HiveTask): HiveDecision { return this.mesh.select(task); }

  reward(agentId: string, amount: number, reason: string, destination = `paper:${agentId}`): LedgerEntry {
    return this.payments.propose({ agentId, amount, currency: "USD", reason, destination });
  }

  health() {
    const nodes = this.mesh.snapshot();
    return {
      nodes: nodes.length,
      healthy: nodes.filter((n) => n.health > 0.5).length,
      averageLoad: nodes.length ? +(nodes.reduce((s, n) => s + n.load, 0) / nodes.length).toFixed(4) : 0,
      payments: this.payments.totals(),
    };
  }
}
