import type { Agent } from "./types";
import type { AgentRole, Lifecycle, RoleState } from "./roles";

/** Compact runtime state for dynamic agent clusters. */
export type ClusterNodeState = {
  agentId: string;
  role: AgentRole;
  lifecycle: Lifecycle;
  capacity: number;
  reliability: number;
  latencyMs: number;
  load: number;
  capabilityScore: number;
};

export type AgentCluster = {
  id: string;
  members: string[];
  supervisorId: string | null;
  epoch: number;
};

/**
 * Pragmatic supervisor selection.
 * Odd cluster size may trigger an election, but node count alone never
 * decides promotion. Capability, reliability, capacity and load are scored.
 */
export function electSupervisor(nodes: ClusterNodeState[]): string | null {
  if (nodes.length < 3) return null;
  const candidates = nodes.filter((n) => n.lifecycle !== "retired" && n.lifecycle !== "recovering");
  if (candidates.length < 2) return null;

  const score = (n: ClusterNodeState) =>
    n.capabilityScore * 0.35 +
    n.reliability * 0.3 +
    n.capacity * 0.2 +
    (1 - Math.min(1, n.load)) * 0.1 +
    (1 / (1 + Math.max(0, n.latencyMs))) * 0.05;

  return [...candidates].sort((a, b) => score(b) - score(a) || a.agentId.localeCompare(b.agentId))[0]?.agentId ?? null;
}

export type HierarchyTransition = {
  cluster: AgentCluster;
  promoted?: string;
  demoted?: string;
  reason: "cluster-formed" | "cluster-changed" | "supervisor-failed" | "manual";
};

/** Build a deterministic cluster state from current agents. */
export function formCluster(id: string, agents: Agent[], states: Map<string, RoleState>, epoch = 1): AgentCluster {
  const members = agents.map((a) => a.id).sort();
  const runtime: ClusterNodeState[] = agents.map((a) => {
    const state = states.get(a.id);
    return {
      agentId: a.id,
      role: state?.role ?? "executor",
      lifecycle: state?.lifecycle ?? "idle",
      capacity: Math.min(1, a.genome.parallelism / 8),
      reliability: Math.max(0, Math.min(1, a.stats.reliability)),
      latencyMs: Math.max(0, a.stats.hoursSpent * 10),
      load: Math.max(0, Math.min(1, a.genome.parallelism / 8)),
      capabilityScore: Math.max(0, Math.min(1, a.stats.fitness / 100)),
    };
  });

  const supervisorId = members.length % 2 === 1 ? electSupervisor(runtime) : null;
  return { id, members, supervisorId, epoch };
}

/** Promote/demote without destroying the agent's prior role history. */
export function transitionSupervisor(cluster: AgentCluster, nextSupervisorId: string | null, reason: HierarchyTransition["reason"]): HierarchyTransition {
  const previous = cluster.supervisorId ?? undefined;
  const next = nextSupervisorId ?? undefined;
  const nextCluster: AgentCluster = { ...cluster, supervisorId: nextSupervisorId, epoch: cluster.epoch + 1 };
  return {
    cluster: nextCluster,
    promoted: next && next !== previous ? next : undefined,
    demoted: previous && previous !== next ? previous : undefined,
    reason,
  };
}

/** The cluster stays valid only while its supervisor remains a healthy member. */
export function requiresReelection(cluster: AgentCluster, states: Map<string, RoleState>): boolean {
  if (!cluster.supervisorId) return true;
  const state = states.get(cluster.supervisorId);
  return !state || state.lifecycle === "retired" || state.lifecycle === "recovering" || !cluster.members.includes(cluster.supervisorId);
}
