import type { MeshTopology } from "./meshNet";
import type { GenerationMetrics } from "./metrics";
import type { RoleState } from "./roles";
import type { Agent, MeshField } from "./types";

export type HealthLevel = "healthy" | "warning" | "critical";

export interface HealthReport {
  level: HealthLevel;
  score: number;
  farm: { score: number; issues: string[] };
  mesh: { score: number; issues: string[] };
  alerts: string[];
  at: number;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function assessHealth(input: {
  agents: Agent[];
  roles: Map<string, RoleState>;
  topology: MeshTopology;
  metrics: GenerationMetrics | null;
  field: MeshField;
  halted: string | null;
  capital: number;
}): HealthReport {
  const { agents, roles, topology, metrics, field, halted, capital } = input;
  const farmIssues: string[] = [];
  const meshIssues: string[] = [];
  let farm = 100;

  const degraded = [...roles.values()].filter((r) => r.lifecycle === "degraded" || r.lifecycle === "recovering").length;
  const degradedPct = agents.length ? degraded / agents.length : 0;
  if (degradedPct > 0.5) {
    farm -= 35;
    farmIssues.push(`${Math.round(degradedPct * 100)}% agents degraded`);
  } else if (degradedPct > 0.25) {
    farm -= 15;
    farmIssues.push(`${Math.round(degradedPct * 100)}% agents degraded`);
  }

  const flagged = agents.filter((a) => a.stats.flagged.length).length;
  if (flagged > agents.length * 0.2) {
    farm -= 15;
    farmIssues.push(`${flagged} agents flagged for gaming`);
  }

  if (metrics) {
    if (metrics.diversity < 0.2) {
      farm -= 20;
      farmIssues.push("strategy convergence (low diversity)");
    }
    if (metrics.fitnessImprovement < 0 && metrics.avgFitness < 0) {
      farm -= 15;
      farmIssues.push("fitness regressing");
    }
    if (metrics.successRate < 0.3 && metrics.throughput > 0) {
      farm -= 10;
      farmIssues.push("low task success rate");
    }
    if (metrics.stepDurationMs > 400) {
      farm -= 5;
      farmIssues.push("slow generation step");
    }
  }
  if (capital <= 0) {
    farm -= 40;
    farmIssues.push("farm out of capital");
  }
  if (halted) {
    farm -= 60;
    farmIssues.push(`circuit breaker: ${halted}`);
  }

  let mesh = 100;
  if (topology.components > 1) {
    mesh -= Math.min(45, topology.components * 6);
    meshIssues.push(`${topology.components} disconnected clusters`);
  }
  if (topology.avgDegree < 1.5) {
    mesh -= 20;
    meshIssues.push("sparse topology");
  }
  if (topology.clustering < 0.05 && topology.links.length > 0) {
    mesh -= 10;
    meshIssues.push("no local clustering");
  }
  if (field.stability < 0.35) {
    mesh -= 20;
    meshIssues.push("mesh field unstable");
  }
  if (field.anomalies > 5) {
    mesh -= 10;
    meshIssues.push(`${field.anomalies} field anomalies`);
  }

  const farmScore = clamp(farm);
  const meshScore = clamp(mesh);
  const score = clamp(farmScore * 0.65 + meshScore * 0.35);
  const level: HealthLevel = score >= 75 ? "healthy" : score >= 45 ? "warning" : "critical";

  return {
    level,
    score,
    farm: { score: farmScore, issues: farmIssues },
    mesh: { score: meshScore, issues: meshIssues },
    alerts: [...farmIssues, ...meshIssues].slice(0, 6),
    at: Date.now(),
  };
}
