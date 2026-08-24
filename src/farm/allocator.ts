import { categoriesFor, type RoleState } from "./roles";
import type { Agent, Opportunity } from "./types";

export interface AllocationPlan {
  assignments: Map<string, Opportunity[]>;
  unassigned: Opportunity[];
  recovered: number;
}

/** Role-aware, capacity-bounded task allocation with recovery redistribution. */
export function allocate(
  ops: Opportunity[],
  agents: Agent[],
  roles: Map<string, RoleState>,
  opts: { maxPerAgent?: number } = {},
): AllocationPlan {
  const assignments = new Map<string, Opportunity[]>();
  const healthy = agents.filter((a) => {
    const lifecycle = roles.get(a.id)?.lifecycle;
    return a.status !== "terminated" && lifecycle !== "recovering" && lifecycle !== "retired";
  });
  const pool = healthy.length ? healthy : agents;
  for (const agent of pool) assignments.set(agent.id, []);

  const cap = opts.maxPerAgent ?? Math.max(1, Math.ceil(ops.length / Math.max(1, pool.length)) + 2);
  const unassigned: Opportunity[] = [];
  const skipped = agents.length - pool.length;
  let recovered = 0;
  let cursor = 0;

  for (const op of ops) {
    let chosen: Agent | undefined;
    for (let i = 0; i < pool.length; i++) {
      const agent = pool[(cursor + i) % pool.length];
      const role = roles.get(agent.id)?.role;
      const fits = role ? categoriesFor(role).includes(op.category) : true;
      if (fits && assignments.get(agent.id)!.length < cap) {
        chosen = agent;
        cursor = (cursor + i + 1) % pool.length;
        break;
      }
    }

    if (!chosen) chosen = pool.find((agent) => assignments.get(agent.id)!.length < cap);
    if (!chosen) {
      unassigned.push(op);
      continue;
    }

    assignments.get(chosen.id)!.push(op);
    if (skipped > 0) recovered++;
  }

  return { assignments, unassigned, recovered: skipped > 0 ? recovered : 0 };
}
