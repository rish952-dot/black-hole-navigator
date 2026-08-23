import { describe, expect, it } from "vitest";
import { FarmEngine } from "@/farm/engine";
import { computeFitness } from "@/farm/fitness";
import { emptyStats, select } from "@/farm/evolution";
import { DEFAULT_CONFIG } from "@/farm/types";

const cfg = { ...DEFAULT_CONFIG, populationSize: 30, opportunitiesPerGen: 300 };

describe("farm engine", () => {
  it("is deterministic for a given seed", () => {
    const a = new FarmEngine({ ...cfg, seed: 7 });
    const b = new FarmEngine({ ...cfg, seed: 7 });
    for (let i = 0; i < 3; i++) {
      a.step();
      b.step();
    }
    expect(a.snapshot().totals).toEqual(b.snapshot().totals);
  });

  it("keeps population size stable across generations", () => {
    const e = new FarmEngine(cfg);
    e.step();
    e.step();
    expect(e.agents.length).toBe(cfg.populationSize);
  });

  it("penalises flagged agents", () => {
    const clean = { ...emptyStats(), netProfit: 100, successRate: 1, reliability: 1, tasksAttempted: 5, tasksSucceeded: 5 };
    const dirty = { ...clean, flagged: ["compute_burn"] };
    expect(computeFitness(dirty, "risk_adjusted")).toBeLessThan(computeFitness(clean, "risk_adjusted"));
  });

  it("selects elites first", () => {
    const e = new FarmEngine(cfg);
    e.step();
    const ranked = [...e.agents].sort((x, y) => y.stats.fitness - x.stats.fitness);
    const sel = select(ranked, cfg);
    expect(sel.elite[0]).toBe(ranked[0]);
    expect(sel.elite.length + sel.survivors.length + sel.terminated.length).toBe(ranked.length);
  });
});
