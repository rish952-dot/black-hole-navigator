import { categoriesFor, type RoleState } from "./roles";
import type { Agent, Opportunity } from "./types";

export interface AllocationPlan {
  assignments: Map<string, Opportunity[]>;
  unassigned: Opportunity[];
  /** work re-allocated away from degraded/recovering agents */
  recovered: number;
}

/**
 * Role-aware, capacity-bounded task allocation.
 * Agents in `recovering`/`retired` lifecycle receive no new work — their share
 * is redistributed to healthy agents (recovery path).
 */
export function allocate(
  ops: Opportunity[],
  agents: Agent[],
  roles: Map<string, RoleState>,
  opts: { maxPerAgent?: number } = {},
): AllocationPlan {
  const assignments = new Map<string, Opportunity[]>();
  const healthy = agents.filter((a) => {
    const st = roles.get(a.id)?.lifecycle;
    return a.status !== "terminated" && st !== "recovering" && st !== "retired";
  });
  const pool = healthy.length ? healthy : agents;
  for (const a of pool) assignments.set(a.id, []);

  const cap = opts.maxPerAgent ?? Math.max(1, Math.ceil(ops.length / Math.max(1, pool.length)) + 2);
  const unassigned: Opportunity[] = [];
  let recovered = 0;
  const skipped = agents.length - pool.length;

  let cursor = 0;
  for (const op of ops) {
    // Prefer an agent whose role covers this category and that has capacity.
    let chosen: Agent | undefined;
    for (let i = 0; i < pool.length; i++) {
      const a = pool[(cursor + i) % pool.length];
      const role = roles.get(a.id)?.role;
      const fits = role ? categoriesFor(role).includes(op.category) : true;
      if (fits && (assignments.get(a.id)!.length < cap)) {
        chosen = a;
        cursor = (cursor + i + 1) % pool.length;
        break;
      }
    }
    if (!chosen) {
      const a = pool.find((x) => assignments.get(x.id)!.length < cap);
      if (a) chosen = a;
    }
    if (!chosen) {
      unassigned.push(op);
      continue;
    }
    assignments.get(chosen.id)!.push(op);
    if (skipped > 0) recovered++;
  }

  return { assignments, unassigned, recovered: skipped > 0 ? recovered : 0 };
}
