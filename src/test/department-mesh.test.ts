import { describe, expect, it } from "vitest";
import { CentralMind } from "../farm/central-mind";
import { createDefaultDepartmentMesh } from "../farm/department-mesh";

describe("DepartmentMesh", () => {
  it("connects departments through a central spine and lateral links", () => {
    const mesh = createDefaultDepartmentMesh();
    expect(mesh.neighbors("central-mind")).toContain("hive");
    expect(mesh.neighbors("hive")).toContain("ai");
    expect(mesh.neighbors("finance")).toContain("jobs");
    expect(mesh.neighbors("backend")).toContain("observability");
  });

  it("routes compact vector signals without text payloads", () => {
    const mesh = createDefaultDepartmentMesh();
    mesh.signal("jobs", "execution", "work.ready", {
      confidence: 0.9,
      novelty: 0.2,
      urgency: 0.8,
      strategy: [0.7, 0.4],
    });

    const inbox = mesh.drain("execution");
    expect(inbox).toHaveLength(1);
    expect(inbox[0].type).toBe("work.ready");
    expect(inbox[0].vector.strategy).toEqual([0.7, 0.4]);
  });

  it("bridges task routing and finance through the central mind", () => {
    const mind = new CentralMind({ paymentMode: "paper" });
    mind.addNode({
      id: "worker-1",
      role: "worker",
      provider: "test",
      model: "test",
      load: 0.1,
      health: 1,
      state: { confidence: 0.9, novelty: 0.2, urgency: 0.8, strategy: [0.8] },
      peers: [],
      capabilities: ["analysis"],
    });

    mind.route({
      id: "task-1",
      kind: "analysis",
      priority: 0.8,
      requiredCapabilities: ["analysis"],
      vector: { confidence: 0.9, novelty: 0.2, urgency: 0.8, strategy: [0.8] },
    });

    const reward = mind.reward("worker-1", 5, "completed task");
    expect(reward.status).toBe("PROPOSED");
    expect(mind.departments.drain("hive")).toHaveLength(1);
    expect(mind.departments.drain("central-mind")).toHaveLength(1);
  });
});
