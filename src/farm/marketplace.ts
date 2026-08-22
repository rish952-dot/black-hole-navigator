import { RNG } from "./rng";
import type { Opportunity, TaskCategory } from "./types";

/**
 * Synthetic marketplace — pluggable connector shape so real sources can be
 * added later without changing the evolution engine.
 */
export interface OpportunitySource {
  id: string;
  discoverTasks(count: number, rng: RNG): Opportunity[];
}

interface CategorySpec {
  category: TaskCategory;
  payout: [number, number];
  duration: [number, number];
  difficulty: [number, number];
  tools: string[];
  weight: number;
}

const SPECS: CategorySpec[] = [
  { category: "classification", payout: [10, 25], duration: [2, 8], difficulty: [0.05, 0.3], tools: ["llm"], weight: 0.3 },
  { category: "research", payout: [60, 160], duration: [10, 40], difficulty: [0.25, 0.6], tools: ["browser", "search"], weight: 0.25 },
  { category: "data-cleaning", payout: [70, 180], duration: [8, 35], difficulty: [0.2, 0.55], tools: ["python", "file-processing"], weight: 0.2 },
  { category: "analysis", payout: [180, 420], duration: [20, 60], difficulty: [0.4, 0.75], tools: ["data-analysis", "python"], weight: 0.15 },
  { category: "coding", payout: [300, 900], duration: [30, 120], difficulty: [0.5, 0.95], tools: ["code-exec", "python"], weight: 0.1 },
];

function weightedSpec(rng: RNG): CategorySpec {
  const r = rng.next();
  let acc = 0;
  for (const s of SPECS) {
    acc += s.weight;
    if (r <= acc) return s;
  }
  return SPECS[SPECS.length - 1];
}

export class SyntheticMarketplace implements OpportunitySource {
  id = "synthetic";
  private counter = 0;

  discoverTasks(count: number, rng: RNG): Opportunity[] {
    const out: Opportunity[] = [];
    for (let i = 0; i < count; i++) {
      const s = weightedSpec(rng);
      const difficulty = +rng.range(s.difficulty[0], s.difficulty[1]).toFixed(3);
      const durationMin = Math.round(rng.range(s.duration[0], s.duration[1]));
      out.push({
        id: `op-${this.counter++}`,
        category: s.category,
        payout: Math.round(rng.range(s.payout[0], s.payout[1])),
        difficulty,
        durationMin,
        computeCost: +(durationMin * rng.range(0.25, 0.8)).toFixed(2),
        baseSuccessProb: +Math.max(0.08, 1 - difficulty * rng.range(0.75, 1.1)).toFixed(3),
        requiredTools: s.tools,
        competition: +rng.range(0, 0.6).toFixed(2),
      });
    }
    return out;
  }
}
