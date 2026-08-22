import { RNG } from "./rng";
import type { Genome, MeshField, PricingStrategy, RetryPolicy, TaskSelectionStrategy } from "./types";

export const MODELS = [
  "gemini-flash-lite",
  "gemini-flash",
  "gemini-pro",
  "gpt-mini",
  "gpt-standard",
] as const;

/** Relative per-minute compute price of each model. Drives economic pressure. */
export const MODEL_COST: Record<string, number> = {
  "gemini-flash-lite": 0.4,
  "gemini-flash": 0.8,
  "gemini-pro": 2.2,
  "gpt-mini": 1.0,
  "gpt-standard": 3.0,
};

/** Relative capability — better models raise success probability. */
export const MODEL_SKILL: Record<string, number> = {
  "gemini-flash-lite": 0.72,
  "gemini-flash": 0.84,
  "gemini-pro": 0.95,
  "gpt-mini": 0.86,
  "gpt-standard": 0.96,
};

export const TOOLS = [
  "browser",
  "python",
  "code-exec",
  "file-processing",
  "data-analysis",
  "api",
  "search",
  "llm",
] as const;

const SELECTION: TaskSelectionStrategy[] = ["greedy", "roi", "safe", "volume", "arbitrage"];
const PRICING: PricingStrategy[] = ["fixed", "aggressive", "conservative"];
const RETRY: RetryPolicy[] = ["none", "once", "adaptive"];

export function randomGenome(rng: RNG): Genome {
  const toolCount = rng.int(2, 6);
  const tools = [...TOOLS].sort(() => rng.next() - 0.5).slice(0, toolCount);
  return {
    model: rng.pick(MODELS),
    temperature: +rng.range(0.05, 0.9).toFixed(2),
    riskTolerance: +rng.range(0.05, 0.95).toFixed(2),
    minimumExpectedProfit: +rng.range(5, 120).toFixed(1),
    maximumTaskDuration: Math.round(rng.range(5, 90)),
    verificationLevel: +rng.range(0.1, 1).toFixed(2),
    researchDepth: +rng.range(0.1, 1).toFixed(2),
    parallelism: rng.int(1, 6),
    toolPreferences: tools,
    taskSelectionStrategy: rng.pick(SELECTION),
    pricingStrategy: rng.pick(PRICING),
    retryPolicy: rng.pick(RETRY),
    computeBudget: Math.round(rng.range(40, 200)),
  };
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * Mutate a genome. `pressure` is amplified by the black hole mesh field:
 * high curvature / anomalies => wilder mutations (symbiotic coupling).
 */
export function mutate(g: Genome, rng: RNG, rate: number, pressure = 1): Genome {
  const p = clamp(pressure, 0.25, 3);
  const n = <T extends number>(v: T, sigma: number, lo: number, hi: number) =>
    rng.chance(rate) ? +clamp(v + rng.gauss(sigma * p), lo, hi).toFixed(2) : v;

  const out: Genome = {
    ...g,
    toolPreferences: [...g.toolPreferences],
    temperature: n(g.temperature, 0.12, 0.02, 1.2),
    riskTolerance: n(g.riskTolerance, 0.12, 0.01, 1),
    minimumExpectedProfit: +clamp(
      rng.chance(rate) ? g.minimumExpectedProfit + rng.gauss(18 * p) : g.minimumExpectedProfit,
      1,
      400,
    ).toFixed(1),
    maximumTaskDuration: Math.round(
      clamp(rng.chance(rate) ? g.maximumTaskDuration + rng.gauss(12 * p) : g.maximumTaskDuration, 3, 180),
    ),
    verificationLevel: n(g.verificationLevel, 0.12, 0, 1),
    researchDepth: n(g.researchDepth, 0.12, 0, 1),
    parallelism: Math.round(clamp(rng.chance(rate) ? g.parallelism + rng.gauss(1.2 * p) : g.parallelism, 1, 8)),
    computeBudget: Math.round(clamp(rng.chance(rate) ? g.computeBudget + rng.gauss(25 * p) : g.computeBudget, 10, 400)),
  };

  // Strategy / model / tool mutations.
  if (rng.chance(rate * 0.5)) out.taskSelectionStrategy = rng.pick(SELECTION);
  if (rng.chance(rate * 0.35)) out.pricingStrategy = rng.pick(PRICING);
  if (rng.chance(rate * 0.35)) out.retryPolicy = rng.pick(RETRY);
  if (rng.chance(rate * 0.4)) out.model = rng.pick(MODELS);
  if (rng.chance(rate * 0.5)) {
    const t = rng.pick(TOOLS);
    out.toolPreferences = out.toolPreferences.includes(t)
      ? out.toolPreferences.filter((x) => x !== t)
      : [...out.toolPreferences, t];
    if (out.toolPreferences.length === 0) out.toolPreferences = [rng.pick(TOOLS)];
  }
  return out;
}

/** Uniform crossover — child inherits each trait group from either parent. */
export function crossover(a: Genome, b: Genome, rng: RNG): Genome {
  const pick = <K extends keyof Genome>(k: K): Genome[K] => (rng.chance(0.5) ? a[k] : b[k]);
  return {
    model: pick("model"),
    temperature: pick("temperature"),
    riskTolerance: pick("riskTolerance"),
    minimumExpectedProfit: pick("minimumExpectedProfit"),
    maximumTaskDuration: pick("maximumTaskDuration"),
    verificationLevel: pick("verificationLevel"),
    researchDepth: pick("researchDepth"),
    parallelism: pick("parallelism"),
    toolPreferences: [...new Set([...a.toolPreferences, ...b.toolPreferences])].slice(0, 6),
    taskSelectionStrategy: pick("taskSelectionStrategy"),
    pricingStrategy: pick("pricingStrategy"),
    retryPolicy: pick("retryPolicy"),
    computeBudget: pick("computeBudget"),
  };
}

export function clone(g: Genome): Genome {
  return { ...g, toolPreferences: [...g.toolPreferences] };
}

/** Coarse signature used for population-convergence detection. */
export function signature(g: Genome): string {
  return [
    g.model,
    g.taskSelectionStrategy,
    g.pricingStrategy,
    Math.round(g.riskTolerance * 5),
    Math.round(g.verificationLevel * 5),
    Math.round(g.minimumExpectedProfit / 25),
  ].join("|");
}

/** Mesh field -> mutation pressure multiplier (the symbiosis). */
export function meshPressure(f: MeshField): number {
  return clamp(0.6 + f.curvature * 0.8 + f.energyDensity * 0.5 + f.anomalies * 0.05 + (1 - f.stability) * 1.2, 0.3, 3);
}
