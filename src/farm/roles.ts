import type { Agent, TaskCategory } from "./types";

/** Autonomous specialisations. Derived from the genome, not hand-assigned. */
export type AgentRole = "scout" | "executor" | "verifier" | "treasurer" | "healer" | "governor";

export const ROLES: AgentRole[] = ["scout", "executor", "verifier", "treasurer", "healer", "governor"];

/** Lifecycle of an autonomous worker, independent of evolutionary status. */
export type Lifecycle = "spawning" | "idle" | "working" | "degraded" | "recovering" | "retired";

export interface RoleState {
  role: AgentRole;
  lifecycle: Lifecycle;
  /** consecutive failed cycles — drives degradation + recovery */
  strikes: number;
  recoveries: number;
  assignedCategories: TaskCategory[];
}

const CATEGORY_BY_ROLE: Record<AgentRole, TaskCategory[]> = {
  scout: ["research", "analysis"],
  executor: ["coding", "data-cleaning", "classification"],
  verifier: ["classification", "analysis"],
  treasurer: ["analysis", "data-cleaning"],
  healer: ["data-cleaning", "research"],
  governor: ["research", "analysis", "coding", "classification", "data-cleaning"],
};

/** Deterministic role assignment from genome traits. */
export function deriveRole(a: Agent): AgentRole {
  const g = a.genome;
  if (g.researchDepth > 0.75 && g.riskTolerance > 0.5) return "scout";
  if (g.verificationLevel > 0.8) return "verifier";
  if (g.minimumExpectedProfit > 80) return "treasurer";
  if (g.retryPolicy === "adaptive" && g.verificationLevel > 0.45) return "healer";
  if (g.parallelism >= 6) return "governor";
  return "executor";
}

export function initialRoleState(a: Agent): RoleState {
  const role = deriveRole(a);
  return { role, lifecycle: "spawning", strikes: 0, recoveries: 0, assignedCategories: CATEGORY_BY_ROLE[role] };
}

/** Categories this role prefers — used by the allocator. */
export function categoriesFor(role: AgentRole): TaskCategory[] {
  return CATEGORY_BY_ROLE[role];
}

export interface CycleOutcome {
  attempted: number;
  succeeded: number;
  netProfit: number;
  capital: number;
}

/**
 * Advances the lifecycle for one generation and reports whether the agent
 * needs recovery (its work should be re-allocated).
 */
export function advanceLifecycle(state: RoleState, out: CycleOutcome): { state: RoleState; needsRecovery: boolean } {
  const next: RoleState = { ...state };
  const failed = out.attempted > 0 && out.succeeded / out.attempted < 0.35;
  const broke = out.capital <= 0;

  if (broke) {
    next.lifecycle = "retired";
    next.strikes = state.strikes + 1;
    return { state: next, needsRecovery: true };
  }
  if (failed || out.netProfit < 0) {
    next.strikes = state.strikes + 1;
  } else if (out.attempted > 0) {
    next.strikes = Math.max(0, state.strikes - 1);
  }

  if (next.strikes >= 3) {
    next.lifecycle = "recovering";
    next.recoveries = state.recoveries + 1;
    next.strikes = 0;
    return { state: next, needsRecovery: true };
  }
  if (next.strikes >= 1) next.lifecycle = "degraded";
  else next.lifecycle = out.attempted > 0 ? "working" : "idle";

  return { state: next, needsRecovery: false };
}

export function roleHistogram(states: Iterable<RoleState>): Record<AgentRole, number> {
  const hist = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<AgentRole, number>;
  for (const s of states) hist[s.role]++;
  return hist;
}
