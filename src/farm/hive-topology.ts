export type HiveRole = "queen" | "specialist" | "worker" | "scout";
export type HiveTopology = "hierarchical" | "mesh" | "hierarchical-mesh" | "adaptive";
export type Consensus = "raft" | "gossip" | "quorum" | "crdt";

export type VectorState = {
  confidence: number;
  novelty: number;
  urgency: number;
  strategy: number[];
};

export type HiveNode = {
  id: string;
  role: HiveRole;
  provider: string;
  model: string;
  load: number;
  health: number;
  state: VectorState;
  peers: string[];
  capabilities: string[];
};

export type HiveTask = {
  id: string;
  kind: string;
  priority: number;
  requiredCapabilities?: string[];
  vector?: VectorState;
};

export type HiveDecision = {
  taskId: string;
  selectedNodeIds: string[];
  topology: HiveTopology;
  consensus: Consensus;
  reason: string;
};

const clamp = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

export class HiveTopologicalMesh {
  private nodes = new Map<string, HiveNode>();

  constructor(
    readonly topology: HiveTopology = "hierarchical-mesh",
    readonly consensus: Consensus = "raft",
  ) {}

  register(node: HiveNode): void {
    this.nodes.set(node.id, {
      ...node,
      load: clamp(node.load),
      health: clamp(node.health),
      peers: [...new Set(node.peers.filter((p) => p !== node.id))],
    });
    this.rewire();
  }

  remove(nodeId: string): void {
    this.nodes.delete(nodeId);
    for (const node of this.nodes.values()) node.peers = node.peers.filter((p) => p !== nodeId);
    this.rewire();
  }

  updateState(nodeId: string, state: Partial<Pick<HiveNode, "load" | "health" | "state">>): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    Object.assign(node, state);
    node.load = clamp(node.load);
    node.health = clamp(node.health);
  }

  snapshot(): HiveNode[] {
    return [...this.nodes.values()].map((n) => ({ ...n, peers: [...n.peers], state: { ...n.state, strategy: [...n.state.strategy] } }));
  }

  select(task: HiveTask): HiveDecision {
    const required = new Set(task.requiredCapabilities ?? []);
    const candidates = this.snapshot()
      .filter((n) => n.health > 0.2 && [...required].every((c) => n.capabilities.includes(c)))
      .sort((a, b) => this.score(b, task) - this.score(a, task));

    const count = this.topology === "hierarchical-mesh" || this.topology === "mesh" ? Math.min(3, candidates.length) : 1;
    const selected = candidates.slice(0, count).map((n) => n.id);
    if (!selected.length) throw new Error(`No healthy hive node can execute task ${task.id}`);

    return {
      taskId: task.id,
      selectedNodeIds: selected,
      topology: this.topology,
      consensus: this.consensus,
      reason: `selected by health/load/vector score; ${selected.length} node(s) participate in ${this.topology}`,
    };
  }

  private score(node: HiveNode, task: HiveTask): number {
    const vector = task.vector;
    const vectorFit = vector
      ? (1 - Math.abs(node.state.confidence - vector.confidence)) * 0.45
        + (1 - Math.abs(node.state.novelty - vector.novelty)) * 0.15
        + (1 - Math.abs(node.state.urgency - vector.urgency)) * 0.15
      : 0.25;
    return node.health * 0.4 + (1 - node.load) * 0.3 + vectorFit + clamp(task.priority) * 0.1;
  }

  private rewire(): void {
    const nodes = [...this.nodes.values()];
    if (this.topology === "mesh" || this.topology === "hierarchical-mesh") {
      for (const node of nodes) node.peers = nodes.filter((p) => p.id !== node.id).map((p) => p.id);
      return;
    }
    const queen = nodes.find((n) => n.role === "queen") ?? nodes[0];
    if (!queen) return;
    for (const node of nodes) node.peers = node.id === queen.id ? nodes.filter((n) => n.id !== node.id).map((n) => n.id) : [queen.id];
  }
}
