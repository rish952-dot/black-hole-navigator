import { CentralMind } from "./central-mind";
import type { HiveNode, HiveRole } from "./hive-topology";
import { encodeVector, type AgentVector } from "./vector-bus";
import type { Agent, Opportunity } from "./types";

/**
 * Hierarchical hive architecture (from the farm blueprint):
 *
 *      OWNER/ADMIN — sole control over the account & central mind;
 *                    policy + approvals; the mind still runs autonomously
 *           ↓
 *      CENTRAL MIND — supervises every worker's performance, routes tasks,
 *                     receives revenue deposits, proposes payouts
 *           ↓
 *      HIVE LAYERS — the "hive": a layer of mesh on top of the raw mesh.
 *                     Layers never strip a module's ability to work
 *           ↓
 *      WORKER AGENTS — embedded in the existing mesh; they talk among
 *                      themselves with compact vectors (no transcripts)
 */

export type HiveLayerId = "queen" | "operations" | "workers" | "scouts";

export interface HiveLayer {
  id: HiveLayerId;
  role: HiveRole;
  nodes: HiveNode[];
  /** Layering never removes a node's ability to execute work. */
  canWork: boolean;
}

export type OwnerAction = "payout" | "halt" | "mode-change" | "config";

export interface PolicyDecision {
  action: OwnerAction;
  approved: boolean;
  reason: string;
  at: string;
}

export type DepositStatus = "pending" | "approved" | "rejected";

export interface Deposit {
  id: string;
  from: string;
  amount: number;
  status: DepositStatus;
  generation: number;
  at: string;
}

export interface InterAgentMessage {
  from: string;
  to?: string;
  vector: AgentVector;
  at: string;
}

const money = (n: number) => +(Math.round(n * 100) / 100).toFixed(2);
const now = () => new Date().toISOString();

let seq = 0;

export class HiveArchitecture {
  readonly mind: CentralMind;
  private layers: HiveLayer[] = [];
  private messages: InterAgentMessage[] = [];
  private deposits: Deposit[] = [];
  private accountBalance = 0;
  private paused = false;
  private readonly decisions: PolicyDecision[] = [];

  constructor(mind = new CentralMind()) {
    this.mind = mind;
    for (const [id, role] of [
      ["queen", "queen"],
      ["operations", "specialist"],
      ["workers", "worker"],
      ["scouts", "scout"],
    ] as [HiveLayerId, HiveRole][]) {
      this.layers.push({ id, role, nodes: [], canWork: true });
    }
  }

  /* ---- OWNER layer: sole control over account + mind ---- */

  /** Owner gate. The mind works autonomously; only account/policy actions need approval. */
  decide(action: OwnerAction, approved: boolean, reason = ""): PolicyDecision {
    const decision: PolicyDecision = { action, approved, reason: reason || (approved ? "owner approved" : "owner rejected"), at: now() };
    this.decisions.push(decision);
    return decision;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  isPaused(): boolean {
    return this.paused;
  }

  /* ---- HIVE layer: workers embedded on the existing mesh ---- */

  embed(node: Partial<HiveNode> & { id: string; role?: HiveRole }): HiveLayer {
    const full: HiveNode = {
      id: node.id,
      role: node.role ?? "worker",
      provider: node.provider ?? "synthetic",
      model: node.model ?? "farm",
      load: node.load ?? 0,
      health: node.health ?? 1,
      state: node.state ?? { confidence: 0.5, novelty: 0, urgency: 0, strategy: [] },
      peers: node.peers ?? [],
      capabilities: node.capabilities ?? ["task"],
    };
    const layer = this.layers.find((l) => l.role === full.role) ?? this.layers.find((l) => l.id === "workers")!;
    layer.nodes.push(full);
    this.mind.addNode(full);
    return layer;
  }

  remove(nodeId: string): void {
    for (const layer of this.layers) {
      layer.nodes = layer.nodes.filter((n) => n.id !== nodeId);
    }
    this.mind.removeNode(nodeId);
  }

  /* ---- WORKER layer: agents talk among themselves using vectors ---- */

  /** Compact vector messaging — machine-to-machine, no chat transcripts. */
  talk(from: Agent, opportunity: Opportunity, generation: number, expectedValue: number, confidence: number, to?: string): AgentVector {
    const vector = encodeVector(from, opportunity, generation, expectedValue, confidence);
    this.messages.push({ from: from.id, to, vector, at: now() });
    if (this.messages.length > 500) this.messages.splice(0, this.messages.length - 500);
    return vector;
  }

  /* ---- CENTRAL MIND layer: checks performance, receives deposits ---- */

  /** Workers deposit earnings into the central account; owner approves release. */
  deposit(from: string, amount: number, generation: number): Deposit {
    const d: Deposit = { id: `dep-${++seq}`, from, amount: money(amount), status: "pending", generation, at: now() };
    this.deposits.push(d);
    return d;
  }

  approveDeposit(id: string, approved: boolean): Deposit | null {
    const d = this.deposits.find((x) => x.id === id);
    if (!d || d.status !== "pending") return null;
    this.decide("payout", approved, approved ? "deposit released" : "deposit rejected");
    d.status = approved ? "approved" : "rejected";
    if (approved) this.accountBalance = money(this.accountBalance + d.amount);
    return d;
  }

  /** Autonomous performance review across every embedded worker. */
  review() {
    const health = this.mind.health();
    const all = this.layers.flatMap((l) => l.nodes);
    const flagged = all.filter((n) => n.health < 0.5).map((n) => n.id);
    for (const id of flagged) this.mind.signal("central-mind", "hive", "performance.flag", { confidence: 0.9, novelty: 0, urgency: 0.8, strategy: [] });
    return { workers: all.length, flagged, health };
  }

  /* ---- Snapshot ---- */

  snapshot() {
    return {
      paused: this.paused,
      account: { balance: this.accountBalance, pending: this.deposits.filter((d) => d.status === "pending").length, deposits: this.deposits.slice(-8) },
      layers: this.layers.map((l) => ({ id: l.id, role: l.role, nodes: l.nodes.map((n) => n.id), canWork: l.canWork })),
      mind: this.review().health,
      traffic: { vectors: this.messages.length, recent: this.messages.slice(-4) },
      decisions: this.decisions.slice(-4),
    };
  }
}
