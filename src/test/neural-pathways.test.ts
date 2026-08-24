import { describe, expect, it } from "vitest";
import { CentralMind } from "../farm/central-mind";
import { NeuralPathwayNetwork } from "../farm/neural-pathways";
import type { VectorState } from "../farm/hive-topology";

const vector: VectorState = { confidence: 0.9, novelty: 0.5, urgency: 0.8, strategy: [0.8, 0.4] };

describe("NeuralPathwayNetwork", () => {
  it("strengthens synapses hebbianly and saturates at 1", () => {
    const net = new NeuralPathwayNetwork({ learningRate: 0.5 });
    net.connect("a", "b", 0.2);
    const w1 = net.strengthen("a", "b", 1);
    const w2 = net.strengthen("a", "b", 1);
    expect(w1).toBeGreaterThan(0.2);
    expect(w2).toBeGreaterThan(w1);
    for (let i = 0; i < 50; i++) net.strengthen("a", "b", 1);
    expect(net.pathwaysFor("a")[0].weight).toBeLessThanOrEqual(1);
  });

  it("propagates attenuated vectors across pathways up to maxHops", () => {
    const net = new NeuralPathwayNetwork();
    net.connect("a", "b", 0.5);
    net.connect("b", "c", 0.5);
    net.connect("c", "d", 0.5);

    const oneHop = net.propagate("a", vector, 1);
    expect(oneHop.map((s) => s.nodeId)).toEqual(["b"]);
    expect(oneHop[0].vector.confidence).toBeCloseTo(vector.confidence * 0.5);

    const twoHops = net.propagate("a", vector, 2);
    expect(twoHops.map((s) => s.nodeId)).toEqual(["b", "c"]);
    const toC = twoHops.find((s) => s.nodeId === "c")!;
    expect(toC.strength).toBeCloseTo(0.25);
    expect(toC.vector.confidence).toBeCloseTo(vector.confidence * 0.25);
  });

  it("decays idle synapses and prunes them below minWeight", () => {
    const net = new NeuralPathwayNetwork({ decayRate: 0.5, minWeight: 0.1 });
    net.connect("a", "b", 0.15);
    expect(net.decay()).toBe(1);
    expect(net.snapshot()).toHaveLength(0);
  });

  it("removes all synapses when a node leaves", () => {
    const net = new NeuralPathwayNetwork();
    net.wireGroup(["a", "b", "c"]);
    expect(net.snapshot().length).toBeGreaterThan(0);
    expect(net.removeNode("b")).toBe(4);
    expect(net.pathwaysFor("b")).toHaveLength(0);
    expect(net.pathwaysFor("a")).toHaveLength(2);
  });
});

describe("CentralMind neural pathways", () => {
  const node = (id: string, load = 0.1) => ({
    id,
    role: "worker" as const,
    provider: "test",
    model: "test",
    load,
    health: 1,
    state: { confidence: 0.9, novelty: 0.2, urgency: 0.8, strategy: [0.8] },
    peers: [] as string[],
    capabilities: ["analysis"],
  });

  it("wires agents when they join and strengthens co-selected agents on route", () => {
    const mind = new CentralMind({ paymentMode: "paper" });
    mind.addNode(node("worker-1"));
    mind.addNode(node("worker-2"));

    // Joining wires agents together with baseline synapses.
    expect(mind.pathways.pathwaysFor("worker-1").length).toBeGreaterThan(0);
    const baseline = mind.pathways.stats().averageWeight;

    mind.route({
      id: "task-1",
      kind: "analysis",
      priority: 0.8,
      requiredCapabilities: ["analysis"],
      vector,
    });

    expect(mind.pathways.stats().totalActivations).toBeGreaterThan(0);
    expect(mind.pathways.stats().averageWeight).toBeGreaterThan(baseline);
    expect(mind.health().pathways.pathways).toBeGreaterThan(0);
  });

  it("delivers task vectors from the lead agent to pathway neighbours", () => {
    const mind = new CentralMind({ paymentMode: "paper" });
    mind.addNode(node("worker-1"));
    mind.addNode(node("worker-2"));
    mind.addNode(node("worker-3"));

    const delivered = mind.propagate("worker-1", vector, 2);
    expect(delivered.length).toBeGreaterThan(0);
    expect(delivered.every((s) => s.sourceId === "worker-1")).toBe(true);
    expect(delivered.every((s) => s.vector.confidence <= vector.confidence)).toBe(true);
  });

  it("reinforces inbound pathways when an agent is rewarded", () => {
    const mind = new CentralMind({ paymentMode: "paper" });
    mind.addNode(node("worker-1"));
    mind.addNode(node("worker-2"));

    const before = mind.pathways.snapshot().find((p) => p.to === "worker-1")!.weight;
    mind.reward("worker-1", 100, "completed task");
    const after = mind.pathways.snapshot().find((p) => p.to === "worker-1")!.weight;
    expect(after).toBeGreaterThan(before);
  });

  it("drops pathways when an agent is removed", () => {
    const mind = new CentralMind({ paymentMode: "paper" });
    mind.addNode(node("worker-1"));
    mind.addNode(node("worker-2"));
    mind.removeNode("worker-2");
    expect(mind.pathways.pathwaysFor("worker-2")).toHaveLength(0);
  });
});
