import { CentralPaymentManager, type LedgerEntry } from "./payment-manager";
import { HiveTopologicalMesh, type HiveDecision, type HiveNode, type HiveTask } from "./hive-topology";
import { createDefaultDepartmentMesh, type DepartmentMesh, type DepartmentSignal, type DepartmentVector } from "./department-mesh";

export type CentralMindConfig = {
  topology?: "hierarchical" | "mesh" | "hierarchical-mesh" | "adaptive";
  consensus?: "raft" | "gossip" | "quorum" | "crdt";
  paymentMode?: "paper" | "approval" | "live";
  paymentDailyLimit?: number;
};

export class CentralMind {
  readonly mesh: HiveTopologicalMesh;
  readonly payments: CentralPaymentManager;
  readonly departments: DepartmentMesh;

  constructor(config: CentralMindConfig = {}) {
    this.mesh = new HiveTopologicalMesh(config.topology ?? "hierarchical-mesh", config.consensus ?? "raft");
    this.payments = new CentralPaymentManager(config.paymentMode ?? "paper", config.paymentDailyLimit ?? 100);
    this.departments = createDefaultDepartmentMesh();
  }

  addNode(node: HiveNode): void { this.mesh.register(node); }
  removeNode(nodeId: string): void { this.mesh.remove(nodeId); }

  route(task: HiveTask): HiveDecision {
    const decision = this.mesh.select(task);
    const vector = task.vector ?? { confidence: 0.5, novelty: 0.5, urgency: task.priority, strategy: [] };
    this.departments.signal("central-mind", "hive", "task.routed", vector);
    return decision;
  }

  signal(from: Parameters<DepartmentMesh["signal"]>[0], to: Parameters<DepartmentMesh["signal"]>[1], type: string, vector: DepartmentVector): DepartmentSignal {
    return this.departments.signal(from, to, type, vector);
  }

  broadcast(from: Parameters<DepartmentMesh["broadcast"]>[0], type: string, vector: DepartmentVector): DepartmentSignal[] {
    return this.departments.broadcast(from, type, vector);
  }

  reward(agentId: string, amount: number, reason: string, destination = `paper:${agentId}`): LedgerEntry {
    const entry = this.payments.propose({ agentId, amount, currency: "USD", reason, destination });
    this.departments.signal("finance", "central-mind", "reward.proposed", {
      confidence: 1,
      novelty: 0,
      urgency: 0,
      strategy: [Math.min(1, amount / Math.max(1, this.payments.dailyLimit))],
    });
    return entry;
  }

  health() {
    const nodes = this.mesh.snapshot();
    return {
      nodes: nodes.length,
      healthy: nodes.filter((n) => n.health > 0.5).length,
      averageLoad: nodes.length ? +(nodes.reduce((s, n) => s + n.load, 0) / nodes.length).toFixed(4) : 0,
      payments: this.payments.totals(),
      departments: this.departments.snapshot(),
      pendingSignals: this.departments.pending(),
    };
  }
}
