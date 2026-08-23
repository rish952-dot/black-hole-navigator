import { MODEL_COST, MODEL_SKILL } from "./genome";
import { getAutonomyConfig } from "./autonomy-config";
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
  const toolMatch = op.requiredTools.length === 0
    ? 1
    : op.requiredTools.filter((t) => g.toolPreferences.includes(t)).length / op.requiredTools.length;
  const timeFit = g.maximumTaskDuration >= op.durationMin ? 1 : 0.5;
  const verification = 0.85 + g.verificationLevel * 0.2;
  const research = 0.85 + g.researchDepth * 0.2;
  const overheat = 1 - Math.max(0, g.temperature - 0.7) * 0.25;
  const spread = 1 - Math.max(0, g.parallelism - 4) * 0.06;
  const p = op.baseSuccessProb * skill * (0.55 + 0.45 * toolMatch) * timeFit * verification * research * overheat * spread;
  return Math.min(0.985, Math.max(0.02, p));
}

export interface AutonomyDecision {
  proceed: boolean;
  reason?: string;
}

/**
 * Applies the bounded autonomy policy before an accepted task can execute.
 * LIMITED_REAL/FULL_REAL are deliberately blocked by the simulation runner;
 * this function is a gate, not a real-world execution connector.
 */
export function canProceedAutonomously(
  agent: Agent,
  opportunity: Opportunity,
  cfg: FarmConfig,
  botId = 0,
): AutonomyDecision {
  if (cfg.mode === "DRY_RUN") return { proceed: false, reason: "dry-run mode" };
  if (cfg.mode === "LIMITED_REAL" || cfg.mode === "FULL_REAL") {
    return { proceed: false, reason: `${cfg.mode} is disabled in the simulation runner` };
  }

  const policy = getAutonomyConfig(botId);
  if (!policy.allowedCategories.includes(opportunity.category)) {
    return { proceed: false, reason: `category ${opportunity.category} not whitelisted` };
  }

  const p = successProbability(agent, opportunity);
  const minimumConfidence = Math.max(cfg.autonomyMinimumConfidence, policy.minSuccessProbability);
  if (p < minimumConfidence) {
    return { proceed: false, reason: `success probability ${p.toFixed(2)} below ${minimumConfidence.toFixed(2)}` };
  }

  if (agent.genome.riskTolerance > Math.min(cfg.autonomyRiskTolerance, 0.3)) {
    return { proceed: false, reason: "genome risk tolerance exceeds autonomy cap" };
  }

  if (agent.genome.parallelism > Math.min(cfg.autonomyMaxParallelism, policy.maxParallelism)) {
    return { proceed: false, reason: "parallelism exceeds autonomy cap" };
  }

  if (opportunity.computeCost > policy.maxCompute) {
    return { proceed: false, reason: "compute cost exceeds autonomy cap" };
  }

  if (opportunity.computeCost > agent.capital * 0.1) {
    return { proceed: false, reason: "task cost exceeds 10% of agent capital" };
  }

  return { proceed: true };
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
