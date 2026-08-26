import { describe, expect, it } from "vitest";
import { FarmEngine } from "@/farm/engine";
import { DEFAULT_CONFIG, NEUTRAL_MESH } from "@/farm/types";

/**
 * Regression guard: the finance subsystem must not change existing Farm
 * behaviour. These exercise the same public surface the farm had before the
 * finance layer existed.
 */
describe("farm engine regression", () => {
  it("runs a deterministic generation with the default ledger", () => {
    const engine = new FarmEngine({ ...DEFAULT_CONFIG, populationSize: 10, opportunitiesPerGen: 50, seed: 7 });
    const record = engine.step(NEUTRAL_MESH);

    expect(record.agents).toBe(10);
    expect(Number.isFinite(record.netProfit)).toBe(true);

    const snapshot = engine.snapshot();
    expect(snapshot.transactions.length).toBeGreaterThan(0);
    expect(snapshot.totals.revenue).toBeGreaterThanOrEqual(0);
  });

  it("produces identical economics for identical seeds (simulation untouched)", () => {
    const a = new FarmEngine({ ...DEFAULT_CONFIG, populationSize: 8, opportunitiesPerGen: 40, seed: 99 });
    const b = new FarmEngine({ ...DEFAULT_CONFIG, populationSize: 8, opportunitiesPerGen: 40, seed: 99 });
    const ra = a.step(NEUTRAL_MESH);
    const rb = b.step(NEUTRAL_MESH);
    expect(ra.netProfit).toBe(rb.netProfit);
    expect(ra.bestFitness).toBe(rb.bestFitness);
  });
});
