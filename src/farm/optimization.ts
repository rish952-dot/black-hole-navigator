import type { FarmConfig, Genome, Opportunity } from "./types";

/** Deterministic, simulation-only tuning helpers focused on throughput and realized net profit. */
export const PROFIT_FIRST_CONFIG: Pick<FarmConfig, "fitnessFormula" | "opportunitiesPerGen" | "transactionFeePct"> = {
  fitnessFormula: "net_profit",
  opportunitiesPerGen: 1000,
  transactionFeePct: 0.01,
};

/** Cheap upper-bound score used before expensive agent evaluation. */
export function grossOpportunityScore(op: Opportunity): number {
  const success = op.baseSuccessProb * (1 - op.competition * 0.25);
  return op.payout * success - op.computeCost - op.payout * 0.01;
}

/** Seed agents toward economically useful behavior without guaranteeing outcomes. */
export function tuneGenomeForProfit(g: Genome): Genome {
  return {
    ...g,
    minimumExpectedProfit: Math.min(g.minimumExpectedProfit, 40),
    maximumTaskDuration: Math.max(g.maximumTaskDuration, 60),
    verificationLevel: Math.max(g.verificationLevel, 0.55),
    researchDepth: Math.max(g.researchDepth, 0.45),
    parallelism: Math.min(6, Math.max(2, g.parallelism)),
    pricingStrategy: g.pricingStrategy === "conservative" ? "fixed" : g.pricingStrategy,
  };
}

/** Stable round-robin distribution so every bot sees a mix of high/medium/low value work. */
export function roundRobin<T>(items: readonly T[], buckets: number): T[][] {
  const out = Array.from({ length: Math.max(1, buckets) }, () => [] as T[]);
  items.forEach((item, index) => out[index % out.length].push(item));
  return out;
}
