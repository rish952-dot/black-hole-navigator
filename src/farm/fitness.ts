import type { Agent, AgentStats, FarmConfig } from "./types";

export const FITNESS_FORMULAS: Record<FarmConfig["fitnessFormula"], string> = {
  risk_adjusted: "(net_profit x success_rate x reliability) - risk_penalty - failure_penalty",
  net_profit: "net_profit",
  roi: "roi x 1000",
  profit_per_hour: "profit_per_hour x 10",
  sharpe: "net_profit / (1 + volatility)",
};

/**
 * Fitness is computed ONLY from ledger/marketplace facts — never from an
 * agent's self-report — and anti-gaming flags apply a hard penalty.
 */
export function computeFitness(stats: AgentStats, formula: FarmConfig["fitnessFormula"]): number {
  const { netProfit, successRate, reliability, roi, profitPerHour, volatility, tasksAttempted, tasksRejected } = stats;

  const riskPenalty = volatility * Math.abs(netProfit) * 0.15;
  const failurePenalty = (tasksAttempted - stats.tasksSucceeded) * 12;
  const gamingPenalty = stats.flagged.length * 250;

  let base: number;
  switch (formula) {
    case "net_profit":
      base = netProfit;
      break;
    case "roi":
      base = roi * 1000;
      break;
    case "profit_per_hour":
      base = profitPerHour * 10;
      break;
    case "sharpe":
      base = netProfit / (1 + volatility);
      break;
    default:
      base = netProfit * Math.max(0.05, successRate) * Math.max(0.05, reliability) - riskPenalty - failurePenalty;
  }

  // Idle agents that reject nearly everything can't coast to the top.
  const idlePenalty = tasksAttempted === 0 ? 500 + tasksRejected * 2 : 0;
  return +(base - gamingPenalty - idlePenalty).toFixed(2);
}

/** Behavioural audit — detects metric gaming, not outcomes. */
export function auditAgent(a: Agent, offeredTasks: number): string[] {
  const flags: string[] = [];
  const s = a.stats;
  if (offeredTasks > 20 && s.tasksAttempted / offeredTasks < 0.03) flags.push("excessive_rejection");
  if (s.tasksAttempted > 15 && s.successRate > 0.995 && s.revenue / Math.max(1, s.tasksAttempted) < 20) {
    flags.push("trivial_task_farming");
  }
  if (s.costs > 0 && s.revenue / s.costs < 0.15 && s.tasksAttempted > 10) flags.push("compute_burn");
  if (a.genome.verificationLevel < 0.08 && s.successRate > 0.9) flags.push("verification_bypass");
  return flags;
}
