import { MODEL_COST, MODEL_SKILL } from "./genome";
import type { Agent, FarmConfig, Opportunity, TaskRecord } from "./types";
import { RNG } from "./rng";

export interface Evaluation {
  expectedRevenue: number;
  expectedComputeCost: number;
  transactionCost: number;
  expectedFailureCost: number;
  expectedNetProfit: number;
  expectedROI: number;
  successProb: number;
  capitalRequired: number;
  accept: boolean;
  reason: string;
}

/** Probability the agent completes the opportunity, from genome + model skill. */
export function successProbability(a: Agent, op: Opportunity): number {
  const g = a.genome;
  const skill = MODEL_SKILL[g.model] ?? 0.8;
  const toolMatch = op.requiredTools.filter((t) => g.toolPreferences.includes(t)).length / op.requiredTools.length;
  const timeFit = g.maximumTaskDuration >= op.durationMin ? 1 : 0.5;
  const verification = 0.85 + g.verificationLevel * 0.2;
  const research = 0.85 + g.researchDepth * 0.2;
  const overheat = 1 - Math.max(0, g.temperature - 0.7) * 0.25;
  const spread = 1 - Math.max(0, g.parallelism - 4) * 0.06;
  const p = op.baseSuccessProb * skill * (0.55 + 0.45 * toolMatch) * timeFit * verification * research * overheat * spread;
  return Math.min(0.985, Math.max(0.02, p));
}

export function evaluate(a: Agent, op: Opportunity, cfg: FarmConfig): Evaluation {
  const g = a.genome;
  const p = successProbability(a, op);
  const modelRate = MODEL_COST[g.model] ?? 1;
  const expectedComputeCost = +(op.computeCost * modelRate * (0.7 + g.researchDepth * 0.6)).toFixed(2);
  const payout = op.payout * (g.pricingStrategy === "aggressive" ? 1.08 : g.pricingStrategy === "conservative" ? 0.95 : 1);
  const expectedRevenue = +(payout * p * (1 - op.competition * 0.35)).toFixed(2);
  const transactionCost = +(payout * cfg.transactionFeePct).toFixed(2);
  const expectedFailureCost = +((1 - p) * expectedComputeCost * 0.8).toFixed(2);
  const expectedNetProfit = +(expectedRevenue - expectedComputeCost - transactionCost - expectedFailureCost).toFixed(2);
  const capitalRequired = +(expectedComputeCost + transactionCost).toFixed(2);
  const expectedROI = capitalRequired > 0 ? +(expectedNetProfit / capitalRequired).toFixed(3) : 0;

  let accept = false;
  let reason = "";
  const affordable = capitalRequired <= Math.min(a.capital, cfg.maxTaskCost);
  if (!affordable) {
    reason = "insufficient capital";
  } else if (op.durationMin > g.maximumTaskDuration) {
    reason = "exceeds max duration";
  } else {
    switch (g.taskSelectionStrategy) {
      case "roi":
        accept = expectedROI > 0.5 + (1 - g.riskTolerance);
        reason = `roi ${expectedROI}`;
        break;
      case "safe":
        accept = p > 0.75 && expectedNetProfit > g.minimumExpectedProfit * 0.6;
        reason = `p ${p.toFixed(2)}`;
        break;
      case "volume":
        accept = expectedNetProfit > g.minimumExpectedProfit * 0.35;
        reason = "volume";
        break;
      case "arbitrage":
        accept = expectedNetProfit > g.minimumExpectedProfit && op.competition < 0.3 + g.riskTolerance * 0.4;
        reason = "arbitrage";
        break;
      default:
        accept = expectedNetProfit > g.minimumExpectedProfit;
        reason = "greedy";
    }
    if (p < 0.25 && g.riskTolerance < 0.5) {
      accept = false;
      reason = "risk too high";
    }
  }

  return {
    expectedRevenue,
    expectedComputeCost,
    transactionCost,
    expectedFailureCost,
    expectedNetProfit,
    expectedROI,
    successProb: p,
    capitalRequired,
    accept,
    reason,
  };
}

/** Executes an accepted opportunity in the sandboxed simulation. */
export function execute(a: Agent, op: Opportunity, ev: Evaluation, cfg: FarmConfig, rng: RNG): TaskRecord {
  const g = a.genome;
  let success = rng.chance(ev.successProb);
  let attempts = 1;
  if (!success && g.retryPolicy !== "none" && a.capital > ev.capitalRequired * 2) {
    const retries = g.retryPolicy === "adaptive" ? 2 : 1;
    for (let i = 0; i < retries && !success; i++) {
      attempts++;
      success = rng.chance(ev.successProb * 0.85);
    }
  }

  const compute = +(ev.expectedComputeCost * attempts * rng.range(0.85, 1.25)).toFixed(2);
  const fee = success ? ev.transactionCost : 0;
  // Rejection by the marketplace even after "success" — verification matters.
  const rejected = success && rng.chance(0.06 * (1 - g.verificationLevel));
  const paid = success && !rejected;
  const payout = paid
    ? Math.round(op.payout * (g.pricingStrategy === "aggressive" ? 1.08 : g.pricingStrategy === "conservative" ? 0.95 : 1))
    : 0;
  const penalty = rejected ? +(op.payout * 0.05).toFixed(2) : 0;
  const cost = +(compute + fee + penalty).toFixed(2);

  return {
    id: `${a.id}:${op.id}`,
    agentId: a.id,
    generation: a.generation,
    opportunityId: op.id,
    category: op.category,
    accepted: true,
    success: paid,
    payout,
    cost,
    net: +(payout - cost).toFixed(2),
    durationMin: op.durationMin * attempts,
    note: paid ? `ok x${attempts}` : rejected ? "rejected by client" : `failed x${attempts}`,
  };
}
