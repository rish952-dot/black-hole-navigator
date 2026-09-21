import { describe, expect, it } from "vitest";
import { FarmController } from "@/farm/controller";
import { enforceMode } from "@/farm/finance";
import { buildSavePayload, MAX_GENERATIONS_PER_SAVE, MAX_LEDGER_PER_SAVE } from "@/farm/persistence";
import { DEFAULT_CONFIG, type FarmConfig } from "@/farm/types";

const cfg: FarmConfig = { ...DEFAULT_CONFIG, populationSize: 20, opportunitiesPerGen: 200, seed: 7 };

describe("finance fail-closed", () => {
  it("accepts simulation-class modes", () => {
    expect(enforceMode("SIMULATION").clamped).toBe(false);
    expect(enforceMode("PAPER_MODE").mode).toBe("PAPER_MODE");
  });

  it("clamps real-money modes to SIMULATION", () => {
    const d = enforceMode("LIVE_TRADING");
    expect(d.mode).toBe("SIMULATION");
    expect(d.clamped).toBe(true);
    expect(d.reason).toBeTruthy();
  });
});

describe("FarmController", () => {
  it("produces roles, topology, metrics and health after a step", () => {
    const c = new FarmController(cfg);
    const s = c.step();
    expect(s.roles.size).toBeGreaterThan(0);
    expect(Object.values(s.roleHistogram).reduce((a, b) => a + b, 0)).toBe(s.roles.size);
    expect(s.topology.vectors.size).toBe(s.snapshot.agents.length);
    expect(s.metrics?.generation).toBeGreaterThanOrEqual(0);
    expect(s.health?.score).toBeGreaterThanOrEqual(0);
    expect(s.health?.score).toBeLessThanOrEqual(100);
  });

  it("is deterministic for the same seed", () => {
    const a = new FarmController(cfg);
    const b = new FarmController(cfg);
    for (let i = 0; i < 3; i++) {
      a.step();
      b.step();
    }
    expect(a.engine.snapshot().totals).toEqual(b.engine.snapshot().totals);
  });

  it("refuses a real-money mode by clamping", () => {
    const c = new FarmController({ ...cfg, mode: "LIVE" as FarmConfig["mode"] });
    expect(c.engine.cfg.mode).toBe("SIMULATION");
    expect(c.modeNotice).toBeTruthy();
  });

  it("bounds metrics history", () => {
    const c = new FarmController(cfg, { metricsHistoryLimit: 2 });
    for (let i = 0; i < 5; i++) c.step();
    expect(c.metricsHistory.length).toBeLessThanOrEqual(2);
  });
});

describe("persistence payload", () => {
  it("is bounded and always simulation-mode", () => {
    const c = new FarmController(cfg);
    for (let i = 0; i < 4; i++) c.step();
    const payload = buildSavePayload("run-test-1", { ...cfg, mode: "LIVE" as FarmConfig["mode"] }, c.state());
    expect(payload.action).toBe("save");
    expect(payload.mode).toBe("SIMULATION");
    expect(payload.generations.length).toBeLessThanOrEqual(MAX_GENERATIONS_PER_SAVE);
    expect(payload.ledger.length).toBeLessThanOrEqual(MAX_LEDGER_PER_SAVE);
  });
});
