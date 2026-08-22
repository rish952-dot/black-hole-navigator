import { clone, crossover, meshPressure, mutate, randomGenome, signature } from "./genome";
import { RNG } from "./rng";
import type { Agent, FarmConfig, MeshField } from "./types";

export function emptyStats() {
  return {
    revenue: 0,
    costs: 0,
    netProfit: 0,
    roi: 0,
    tasksAttempted: 0,
    tasksSucceeded: 0,
    tasksRejected: 0,
    successRate: 0,
    reliability: 0.5,
    hoursSpent: 0,
    profitPerHour: 0,
    volatility: 0,
    fitness: 0,
    flagged: [] as string[],
  };
}

let idCounter = 0;
export function nextAgentId(gen: number): string {
  return `g${gen}-a${idCounter++}`;
}
export function resetAgentIds() {
  idCounter = 0;
}

export function spawnSeedPopulation(cfg: FarmConfig, rng: RNG): Agent[] {
  const agents: Agent[] = [];
  for (let i = 0; i < cfg.populationSize; i++) {
    const id = nextAgentId(0);
    agents.push({
      id,
      parentId: null,
      lineage: id,
      generation: 0,
      origin: "seed",
      genome: randomGenome(rng),
      capital: cfg.startingCapital,
      status: "active",
      stats: emptyStats(),
      history: [],
      events: ["born: seed"],
    });
  }
  return agents;
}

/** Strategy diversity = unique genome signatures / population. */
export function diversity(agents: Agent[]): number {
  if (agents.length === 0) return 0;
  return +(new Set(agents.map((a) => signature(a.genome))).size / agents.length).toFixed(3);
}

export interface SelectionResult {
  elite: Agent[];
  survivors: Agent[];
  terminated: Agent[];
}

export function select(ranked: Agent[], cfg: FarmConfig): SelectionResult {
  const n = ranked.length;
  const eliteN = Math.max(1, Math.round(n * cfg.elitePct));
  const survivorN = Math.round(n * cfg.survivorPct);
  return {
    elite: ranked.slice(0, eliteN),
    survivors: ranked.slice(eliteN, eliteN + survivorN),
    terminated: ranked.slice(eliteN + survivorN),
  };
}

/**
 * Capital Allocation Engine — fitness- and reliability-weighted, with a small
 * floor so experimental lineages get a chance but never a large purse.
 */
export function allocateCapital(agents: Agent[], pool: number): void {
  const scores = agents.map((a) => {
    const base = Math.max(0, a.stats.fitness) + 1;
    const rel = 0.5 + a.stats.reliability;
    const exp = a.origin === "experimental" || a.origin === "random" ? 0.25 : 1;
    return base * rel * exp;
  });
  const total = scores.reduce((s, v) => s + v, 0) || 1;
  agents.forEach((a, i) => {
    const share = (scores[i] / total) * pool;
    a.capital = +Math.max(50, share).toFixed(2);
  });
}

export interface BreedResult {
  agents: Agent[];
  stats: { elite: number; offspring: number; mutants: number; crossovers: number; experimental: number; random: number };
}

/**
 * Build the next generation. Mesh field raises mutation pressure (symbiosis),
 * and convergence auto-boosts exploration.
 */
export function breed(
  sel: SelectionResult,
  cfg: FarmConfig,
  rng: RNG,
  gen: number,
  field: MeshField,
  currentDiversity: number,
): BreedResult {
  const pressure = cfg.meshCoupling ? meshPressure(field) : 1;
  const convergenceBoost = currentDiversity < 0.25 ? 2 : currentDiversity < 0.45 ? 1.4 : 1;
  const rate = Math.min(0.95, cfg.mutationRate * convergenceBoost);

  const next: Agent[] = [];
  const stats = { elite: 0, offspring: 0, mutants: 0, crossovers: 0, experimental: 0, random: 0 };

  const make = (
    genome: Agent["genome"],
    parent: Agent | null,
    origin: Agent["origin"],
  ): Agent => {
    const id = nextAgentId(gen);
    return {
      id,
      parentId: parent?.id ?? null,
      lineage: parent?.lineage ?? id,
      generation: gen,
      origin,
      genome,
      capital: cfg.startingCapital,
      status: origin === "elite" ? "elite" : "active",
      stats: emptyStats(),
      history: parent ? [...parent.history] : [],
      events: [`born: ${origin}${parent ? ` <- ${parent.id}` : ""}`],
    };
  };

  const size = cfg.populationSize;
  const quota = {
    elite: Math.round(size * cfg.elitePct),
    eliteKids: Math.round(size * 0.2),
    survivorKids: Math.round(size * 0.3),
    mutants: Math.round(size * 0.2),
    experimental: Math.round(size * 0.1),
  };

  // 1. Elite preservation (exact clone, keeps lineage record).
  for (const e of sel.elite.slice(0, quota.elite)) {
    next.push(make(clone(e.genome), e, "elite"));
    stats.elite++;
  }
  // 2. Elite offspring — mutation + crossover.
  for (let i = 0; i < quota.eliteKids && sel.elite.length; i++) {
    const p = sel.elite[i % sel.elite.length];
    if (rng.chance(cfg.crossoverRate) && sel.elite.length > 1) {
      const q = sel.elite[(i + 1 + rng.int(0, sel.elite.length - 1)) % sel.elite.length];
      next.push(make(mutate(crossover(p.genome, q.genome, rng), rng, rate * 0.5, pressure), p, "crossover"));
      stats.crossovers++;
    } else {
      next.push(make(mutate(p.genome, rng, rate * 0.6, pressure), p, "offspring"));
      stats.offspring++;
    }
  }
  // 3. Survivor offspring — limited mutation.
  const pool = sel.survivors.length ? sel.survivors : sel.elite;
  for (let i = 0; i < quota.survivorKids && pool.length; i++) {
    const p = pool[rng.int(0, pool.length - 1)];
    next.push(make(mutate(p.genome, rng, rate * 0.8, pressure), p, "offspring"));
    stats.offspring++;
  }
  // 4. Heavy mutants from anywhere in the surviving pool.
  const all = [...sel.elite, ...sel.survivors];
  for (let i = 0; i < quota.mutants && all.length; i++) {
    const p = all[rng.int(0, all.length - 1)];
    next.push(make(mutate(p.genome, rng, Math.min(1, rate * 1.6), pressure * 1.3), p, "mutant"));
    stats.mutants++;
  }
  // 5. Experimental + pure random exploration.
  while (next.length < size) {
    const experimental = next.length < size - Math.round(size * cfg.explorationRate);
    const g = randomGenome(rng);
    const a = make(experimental ? mutate(g, rng, 0.6, pressure) : g, null, experimental ? "experimental" : "random");
    a.capital = cfg.startingCapital * 0.25;
    next.push(a);
    if (experimental) stats.experimental++;
    else stats.random++;
  }

  return { agents: next.slice(0, size), stats };
}
