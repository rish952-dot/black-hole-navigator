import { describe, expect, it } from "vitest";
import { FarmEngine } from "../farm/engine";
import { DEFAULT_CONFIG, NEUTRAL_MESH } from "../farm/types";

const cfg = { ...DEFAULT_CONFIG, seed: 42, populationSize: 20, opportunitiesPerGen: 200 };

describe("active job hunting", () => {
  it("agents hunt jobs every generation and record outcomes", () => {
    const engine = new FarmEngine(cfg);
    const record = engine.step(NEUTRAL_MESH);
    expect(record.hunts).toBeGreaterThan(0);
    expect(record.applications).toBeGreaterThan(0);
    expect(record.applications).toBeLessThanOrEqual(record.hunts ?? 0);
    expect(record.accepted).toBeLessThanOrEqual(record.applications ?? 0);
    const snap = engine.snapshot();
    expect(snap.hunts.length).toBeGreaterThan(0);
    for (const h of snap.hunts) {
      expect(h.agentId).toBeTruthy();
      expect(h.jobId).toBeTruthy();
      expect(["skill-gap", "follow-up", "outcome"]).toContain(h.stage);
      if (h.accepted) expect(h.revenue).toBeGreaterThan(0);
    }
  });

  it("culls the bottom 40% and clones the top 10% in their place", () => {
    const engine = new FarmEngine(cfg);
    const record = engine.step(NEUTRAL_MESH);
    expect(record.terminated).toBe(Math.round(20 * 0.4));
    expect(record.cloned).toBeGreaterThanOrEqual(1);
    const next = engine.snapshot().agents;
    expect(next.length).toBe(20);
    const clones = next.filter((a) => a.events.some((e) => e.includes("cloned from top agent")));
    expect(clones.length).toBe(record.cloned);
    for (const c of clones) expect(c.parentId).toBeTruthy();
  });

  it("respects configurable cull/clone percentages", () => {
    const engine = new FarmEngine({ ...cfg, cullPct: 0.25, clonePct: 0.2 });
    const record = engine.step(NEUTRAL_MESH);
    expect(record.terminated).toBe(Math.round(20 * 0.25));
  });

  it("stays deterministic for a fixed seed", () => {
    const a = new FarmEngine(cfg);
    const b = new FarmEngine(cfg);
    const ra = a.step(NEUTRAL_MESH);
    const rb = b.step(NEUTRAL_MESH);
    expect(ra.hunts).toBe(rb.hunts);
    expect(ra.accepted).toBe(rb.accepted);
    expect(ra.cloned).toBe(rb.cloned);
    expect(ra.netProfit).toBe(rb.netProfit);
  });
});
