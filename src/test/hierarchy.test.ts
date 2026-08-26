import { describe, expect, it } from "vitest";
import { formCluster, electSupervisor, requiresReelection, transitionSupervisor, type ClusterNodeState } from "../farm/hierarchy";

const node = (agentId: string, overrides: Partial<ClusterNodeState> = {}): ClusterNodeState => ({
  agentId,
  role: "executor",
  lifecycle: "idle",
  capacity: 0.8,
  reliability: 0.8,
  latencyMs: 20,
  load: 0.2,
  capabilityScore: 0.8,
  ...overrides,
});

describe("dynamic hierarchy", () => {
  it("does not create a supervisor for clusters smaller than three", () => {
    expect(electSupervisor([node("a"), node("b")])).toBeNull();
  });

  it("uses capability and health, not odd count alone, for supervisor selection", () => {
    const winner = electSupervisor([
      node("a", { capabilityScore: 0.4, reliability: 0.9 }),
      node("b", { capabilityScore: 0.95, reliability: 0.95, load: 0.1 }),
      node("c", { capabilityScore: 0.6, reliability: 0.7 }),
    ]);
    expect(winner).toBe("b");
  });

  it("transitions supervisor without changing cluster membership", () => {
    const cluster = { id: "c1", members: ["a", "b", "c"], supervisorId: "a", epoch: 2 };
    const transition = transitionSupervisor(cluster, "b", "supervisor-failed");
    expect(transition.promoted).toBe("b");
    expect(transition.demoted).toBe("a");
    expect(transition.cluster.members).toEqual(["a", "b", "c"]);
    expect(transition.cluster.epoch).toBe(3);
  });

  it("requires re-election when supervisor is unhealthy", () => {
    const cluster = { id: "c1", members: ["a", "b", "c"], supervisorId: "a", epoch: 1 };
    const states = new Map([["a", { role: "governor", lifecycle: "recovering", strikes: 0, recoveries: 1, assignedCategories: [] } as any]]);
    expect(requiresReelection(cluster, states)).toBe(true);
  });

  it("forms an odd-sized cluster with a selected supervisor", () => {
    const agents = [1, 2, 3].map((i) => ({
      id: String(i),
      parentId: null,
      lineage: String(i),
      generation: 0,
      origin: "seed",
      genome: {
        model: "test",
        temperature: 0.2,
        riskTolerance: 0.5,
        minimumExpectedProfit: 20,
        maximumTaskDuration: 30,
        verificationLevel: 0.7,
        researchDepth: 0.6,
        parallelism: 4,
        toolPreferences: [],
        taskSelectionStrategy: "safe",
        pricingStrategy: "fixed",
        retryPolicy: "once",
        computeBudget: 100,
      },
      capital: 100,
      status: "active",
      stats: {
        revenue: 0,
        costs: 0,
        netProfit: 0,
        roi: 0,
        tasksAttempted: 1,
        tasksSucceeded: 1,
        tasksRejected: 0,
        successRate: 1,
        reliability: 0.9,
        hoursSpent: 1,
        profitPerHour: 1,
        volatility: 0,
        fitness: 80,
        flagged: [],
      },
      history: [],
      events: [],
    }));
    const states = new Map(agents.map((a) => [a.id, { role: "executor", lifecycle: "idle", strikes: 0, recoveries: 0, assignedCategories: [] } as any]));
    const cluster = formCluster("c1", agents as any, states, 4);
    expect(cluster.members).toHaveLength(3);
    expect(cluster.supervisorId).not.toBeNull();
    expect(cluster.epoch).toBe(4);
  });
});
