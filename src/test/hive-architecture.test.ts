import { describe, expect, it } from "vitest";
import { HiveArchitecture } from "../farm/hive-architecture";
import type { HiveNode, HiveRole } from "../farm/hive-topology";

function makeNode(id: string, role: HiveRole, health = 1): HiveNode {
  return {
    id,
    role,
    provider: "synthetic",
    model: "farm",
    load: 0,
    health,
    state: { confidence: 0.5, novelty: 0, urgency: 0, strategy: [] },
    peers: [],
    capabilities: ["task"],
  };
}

describe("hierarchical hive architecture", () => {
  it("layers: queen → operations → workers → scouts, each retaining ability to work", () => {
    const arch = new HiveArchitecture();
    const layers = arch.snapshot().layers;
    expect(layers.map((l) => l.id)).toEqual(["queen", "operations", "workers", "scouts"]);
    for (const l of layers) expect(l.canWork).toBe(true);
  });

  it("embeds worker agents in the hive and the central mind", () => {
    const arch = new HiveArchitecture();
    arch.embed(makeNode("w1", "worker"));
    arch.embed(makeNode("q1", "queen"));
    const snap = arch.snapshot();
    expect(snap.layers.find((l) => l.id === "workers")!.nodes).toContain("w1");
    expect(snap.layers.find((l) => l.id === "queen")!.nodes).toContain("q1");
  });

  it("owner alone controls the account; deposits flow through approval", () => {
    const arch = new HiveArchitecture();
    const d = arch.deposit("w1", 123.45, 5);
    expect(d.status).toBe("pending");
    arch.approveDeposit(d.id, true);
    expect(arch.snapshot().account.balance).toBe(123.45);
    const d2 = arch.deposit("w2", 50, 5);
    arch.approveDeposit(d2.id, false);
    expect(arch.snapshot().account.balance).toBeCloseTo(123.45, 2);
  });

  it("owner can pause the mind; review still reports flagged workers", () => {
    const arch = new HiveArchitecture();
    arch.embed(makeNode("w1", "worker", 0.2));
    arch.embed(makeNode("w2", "worker", 0.9));
    arch.pause();
    expect(arch.isPaused()).toBe(true);
    const review = arch.review();
    expect(review.flagged).toContain("w1");
    expect(review.flagged).not.toContain("w2");
    arch.resume();
    expect(arch.isPaused()).toBe(false);
  });

  it("mind supervises embedded workers autonomously through health review", () => {
    const arch = new HiveArchitecture();
    arch.embed(makeNode("s1", "scout"));
    const review = arch.review();
    expect(review.workers).toBe(1);
    expect(review.health.nodes).toBeGreaterThan(0);
  });
});
