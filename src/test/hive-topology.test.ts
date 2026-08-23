import { describe, expect, it } from "vitest";
import { HiveTopologicalMesh } from "@/farm/hive-topology";
import { CentralPaymentManager } from "@/farm/payment-manager";
import { buildJobPath } from "@/farm/job-pathways";

describe("adaptive hive mesh", () => {
  it("connects hierarchical-mesh peers and routes to healthy nodes", () => {
    const mesh = new HiveTopologicalMesh("hierarchical-mesh", "raft");
    mesh.register({ id: "queen", role: "queen", provider: "xai", model: "grok", load: 0.2, health: 1, state: { confidence: 0.8, novelty: 0.5, urgency: 0.4, strategy: [1, 0, 1, 0, 1] }, peers: [], capabilities: ["orchestration"] });
    mesh.register({ id: "worker-a", role: "worker", provider: "groq", model: "llama", load: 0.1, health: 0.95, state: { confidence: 0.8, novelty: 0.5, urgency: 0.4, strategy: [1, 0, 1, 0, 1] }, peers: [], capabilities: ["analysis"] });
    mesh.register({ id: "worker-b", role: "worker", provider: "gemini", model: "flash", load: 0.8, health: 0.9, state: { confidence: 0.4, novelty: 0.7, urgency: 0.8, strategy: [0, 1, 0, 1, 0] }, peers: [], capabilities: ["analysis"] });
    const decision = mesh.select({ id: "task-1", kind: "analysis", priority: 0.8, requiredCapabilities: ["analysis"], vector: { confidence: 0.8, novelty: 0.5, urgency: 0.4, strategy: [1, 0, 1, 0, 1] } });
    expect(decision.selectedNodeIds).toContain("worker-a");
    expect(mesh.snapshot().find((n) => n.id === "worker-a")?.peers).toContain("worker-b");
  });
});

describe("central payment ledger", () => {
  it("keeps payments approval-gated and paper-settleable", () => {
    const payments = new CentralPaymentManager("paper", 100);
    const proposal = payments.propose({ agentId: "worker-a", amount: 5, currency: "USD", reason: "completed task", destination: "paper:worker-a" });
    expect(proposal.status).toBe("PROPOSED");
    expect(payments.approve(proposal.id, "queen").status).toBe("APPROVED");
    expect(payments.settle(proposal.id).status).toBe("SETTLED");
    expect(payments.totals().settled).toBe(5);
  });
});

describe("job pathways", () => {
  it("turns missing skills into an upskill path", () => {
    const path = buildJobPath({ agentId: "a", skills: ["typescript"] }, { id: "j", title: "AI engineer", skills: ["typescript", "python"] });
    expect(path.stage).toBe("skill-gap");
    expect(path.missingSkills).toEqual(["python"]);
  });
});
