import type { Agent, GenerationRecord } from "./types";

export interface FarmHealth {
  agents: number;
  netProfit: number;
  diversity: number;
  maxVolatility: number;
  flagged: number;
  halted: string | null;
  healthy: boolean;
}

/** Central observable supervisor for the farm. It never signs transactions or moves funds. */
export function assessFarm(
  agents: readonly Agent[],
  generations: readonly GenerationRecord[],
  totals: { netProfit: number },
  halted: string | null,
  limits = { minDiversity: 0.4, maxVolatility: 0.8, maxFlags: 2 },
): FarmHealth {
  const maxVolatility = Math.max(0, ...agents.map((a) => a.stats.volatility));
  const flagged = agents.reduce((sum, a) => sum + a.stats.flagged.length, 0);
  const latest = generations.at(-1);
  const diversity = latest?.diversity ?? 0;

  return {
    agents: agents.length,
    netProfit: totals.netProfit,
    diversity,
    maxVolatility,
    flagged,
    halted,
    healthy:
      !halted &&
      diversity >= limits.minDiversity &&
      maxVolatility <= limits.maxVolatility &&
      flagged <= limits.maxFlags,
  };
}
