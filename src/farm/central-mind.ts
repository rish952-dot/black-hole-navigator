import { CentralPaymentManager, type LedgerEntry } from "./payment-manager";
import { HiveTopologicalMesh, type HiveDecision, type HiveNode, type HiveTask } from "./hive-topology";
import { createDefaultDepartmentMesh, type DepartmentMesh, type DepartmentSignal, type DepartmentVector } from "./department-mesh";
import { NeuralPathwayNetwork, type PathwaySignal } from "./neural-pathways";

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
  readonly pathways: NeuralPathwayNetwork;

  constructor(config: CentralMindConfig = {}) {
    this.mesh = new HiveTopologicalMesh(config.topology ?? "hierarchical-mesh", config.consensus ?? "raft");
    this.payments = new CentralPaymentManager(config.paymentMode ?? "paper", config.paymentDailyLimit ?? 100);
    this.departments = createDefaultDepartmentMesh();
    this.pathways = new NeuralPathwayNetwork();
  }

  addNode(node: HiveNode): void {
    this.mesh.register(node);
    this.pathways.wireGroup(this.mesh.snapshot().map((n) => n.id));
  }

  removeNode(nodeId: string): void {
    this.mesh.remove(nodeId);
    this.pathways.removeNode(nodeId);
  }

  route(task: HiveTask): HiveDecision {
    const decision = this.mesh.select(task);
    const vector = task.vector ?? { confidence: 0.5, novelty: 0.5, urgency: task.priority, strategy: [] };
    this.departments.signal("central-mind", "hive", "task.routed", vector);
    // Agents selected together for the same task fire together: wire and strengthen.
    for (const pathway of this.pathways.wireGroup(decision.selectedNodeIds)) {
      this.pathways.strengthen(pathway.from, pathway.to, 0.5 + vector.confidence * 0.5);
    }
    this.pathways.propagate(decision.selectedNodeIds[0], vector);
    return decision;
  }

  /** Propagate a vector from one agent across its neural pathways. */
  propagate(sourceId: string, vector: DepartmentVector, maxHops = 2): PathwaySignal[] {
    return this.pathways.propagate(sourceId, vector, maxHops);
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
    // Reward flows back through the agent's inbound pathways.
    const magnitude = Math.min(1, amount / Math.max(1, this.payments.dailyLimit));
    for (const pathway of this.pathways.pathwaysFor(agentId)) {
      if (pathway.to === agentId) this.pathways.strengthen(pathway.from, agentId, magnitude);
    }
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
      pathways: this.pathways.stats(),
    };
  }
}
