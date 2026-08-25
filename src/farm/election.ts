/**
 * Supervisor election + heartbeat/failover for the hive (from the blueprint).
 *
 * Election: highest-uptime worker becomes supervisor on cluster change.
 * Heartbeat: periodic liveness pings; on timeout, workers demote supervisor
 * and hold a fresh election among the surviving candidates.
 */

export interface ElectableNode {
  id: string;
  uptime: number;
  health: number;
  supervisor: boolean;
  /** Milliseconds since last heartbeat; > timeout → considered dead. */
  lastSeenMs: number;
}

export interface ElectionResult {
  supervisorId: string | null;
  candidates: string[];
  reason: string;
}

export interface PingResult {
  nodeId: string;
  healthy: boolean;
  msSinceLast: number;
}

function elect(nodes: ElectableNode[]): ElectionResult {
  const candidates = nodes.filter((n) => n.health > 0).map((n) => n.id);
  if (candidates.length === 0) return { supervisorId: null, candidates, reason: "no healthy candidates" };
  const winner = nodes.filter((n) => n.health > 0).reduce((a, b) => (a.uptime >= b.uptime ? a : b));
  for (const n of nodes) n.supervisor = n.id === winner.id;
  return { supervisorId: winner.id, candidates, reason: "highest uptime" };
}

export class ElectionProtocol {
  private nodes = new Map<string, ElectableNode>();
  private timeoutMs: number;

  constructor(timeoutMs = 30_000) {
    this.timeoutMs = timeoutMs;
  }

  register(id: string, health = 1): void {
    this.nodes.set(id, { id, uptime: 0, health, supervisor: false, lastSeenMs: 0 });
  }

  remove(id: string): ElectionResult {
    this.nodes.delete(id);
    return this.holdElection();
  }

  /** Recursive tick: increases uptime, records liveness. */
  ping(id: string): PingResult | null {
    const n = this.nodes.get(id);
    if (!n) return null;
    n.lastSeenMs = 0;
    n.uptime += 1;
    return { nodeId: id, healthy: n.health > 0, msSinceLast: 0 };
  }

  /** Mark a node as missing in this tick (it did not ping). Returns true if it was the supervisor. */
  miss(id: string): boolean {
    const n = this.nodes.get(id);
    if (!n) return false;
    n.health = Math.min(n.health, 0.5);
    n.lastSeenMs += 1;
    return n.supervisor;
  }

  holdElection(): ElectionResult {
    const result = elect([...this.nodes.values()]);
    if (this.activeCount() === 0) return { supervisorId: null, candidates: result.candidates, reason: "empty cluster" };
    return result;
  }

  /** Check liveness of every registered node; triggers election if supervisor is stale. */
  evaluate(): { election: ElectionResult | null; dead: string[] } {
    const dead = [...this.nodes.values()].filter((n) => n.lastSeenMs > this.timeoutMs / 100).map((n) => n.id);
    const supervisorDead = dead.some((id) => this.nodes.get(id)?.supervisor);
    if (!supervisorDead) return { election: null, dead };
    for (const id of dead) {
      const n = this.nodes.get(id)!;
      n.health = 0;
    }
    return { election: this.holdElection(), dead };
  }

  activeCount(): number {
    return [...this.nodes.values()].filter((n) => n.health > 0).length;
  }

  supervisor(): ElectableNode | null {
    return [...this.nodes.values()].find((n) => n.supervisor) ?? null;
  }

  snapshot() {
    const nodes = [...this.nodes.values()];
    const sup = this.supervisor();
    return {
      timeoutMs: this.timeoutMs,
      nodes: nodes.length,
      active: this.activeCount(),
      supervisor: sup ? { id: sup.id, uptime: sup.uptime } : null,
      roster: nodes.map((n) => ({ id: n.id, uptime: n.uptime, healthy: n.health > 0, supervisor: n.supervisor })),
    };
  }
}
