import type { Agent, GenerationRecord } from "./types";

export interface GenerationMetrics {
  generation: number;
  population: number;
  survivalRate: number;
  turnover: number;
  avgFitness: number;
  medianFitness: number;
  p90Fitness: number;
  fitnessStdDev: number;
  fitnessImprovement: number;
  diversity: number;
  netProfit: number;
  roi: number;
  successRate: number;
  throughput: number;
  stepDurationMs: number;
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i];
}

export function computeGenerationMetrics(
  record: GenerationRecord,
  agents: Agent[],
  prev: GenerationMetrics | null,
  stepDurationMs: number,
): GenerationMetrics {
  const fits = agents.map((a) => a.stats.fitness).sort((a, b) => a - b);
  const mean = fits.reduce((sum, value) => sum + value, 0) / Math.max(1, fits.length);
  const sd = Math.sqrt(fits.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, fits.length));
  const attempted = agents.reduce((sum, agent) => sum + agent.stats.tasksAttempted, 0);
  const succeeded = agents.reduce((sum, agent) => sum + agent.stats.tasksSucceeded, 0);
  const population = Math.max(1, record.agents);

  return {
    generation: record.index,
    population: record.agents,
    survivalRate: +(1 - record.terminated / population).toFixed(3),
    turnover: +(record.born / population).toFixed(3),
    avgFitness: +mean.toFixed(2),
    medianFitness: +percentile(fits, 50).toFixed(2),
    p90Fitness: +percentile(fits, 90).toFixed(2),
    fitnessStdDev: +sd.toFixed(2),
    fitnessImprovement: prev ? +(mean - prev.avgFitness).toFixed(2) : 0,
    diversity: record.diversity,
    netProfit: record.netProfit,
    roi: record.costs > 0 ? +(record.netProfit / record.costs).toFixed(3) : 0,
    successRate: attempted ? +(succeeded / attempted).toFixed(3) : 0,
    throughput: +(attempted / population).toFixed(2),
    stepDurationMs: +stepDurationMs.toFixed(1),
  };
}

export function trend(series: number[], n = 10): number {
  const recent = series.slice(-n);
  if (recent.length < 2) return 0;
  return +(recent[recent.length - 1] - recent[0]).toFixed(2);
}
