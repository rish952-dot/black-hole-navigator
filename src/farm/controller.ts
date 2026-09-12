import { allocate } from "./allocator";
import { FarmEngine, type FarmSnapshot } from "./engine";
import { enforceMode } from "./finance";
import { assessHealth, type HealthReport } from "./health";
import { adaptWeights, buildTopology, type MeshTopology } from "./meshNet";
import { computeGenerationMetrics, type GenerationMetrics } from "./metrics";
import { advanceLifecycle, initialRoleState, roleHistogram, type AgentRole, type RoleState } from "./roles";
import { NEUTRAL_MESH, type FarmConfig, type MeshField } from "./types";

/**
 * Controller layer: UI → controller → agents → mesh → persistence.
 *
 * The engine stays the single source of economic truth; the controller adds
 * roles/lifecycle, the adaptive mesh topology, metrics and health, and keeps
 * the whole thing cheap enough for mobile (topology fan-out is bounded).
 */
export interface ControllerState {
  snapshot: FarmSnapshot;
  roles: Map<string, RoleState>;
  roleHistogram: Record<AgentRole, number>;
  topology: MeshTopology;
  metrics: GenerationMetrics | null;
  metricsHistory: GenerationMetrics[];
  health: HealthReport | null;
  recoveries: number;
  unassigned: number;
  modeNotice: string | null;
}

export interface ControllerOptions {
  /** Mesh fan-out per agent — lower on mobile/low-end devices. */
  maxLinksPerNode?: number;
  /** Keep at most this many metric rows in memory. */
  metricsHistoryLimit?: number;
}

export class FarmController {
  engine: FarmEngine;
  roles = new Map<string, RoleState>();
  topology: MeshTopology;
  metrics: GenerationMetrics | null = null;
  metricsHistory: GenerationMetrics[] = [];
  health: HealthReport | null = null;
  recoveries = 0;
  unassigned = 0;
  modeNotice: string | null = null;
  private opts: Required<ControllerOptions>;

  constructor(cfg: FarmConfig, opts: ControllerOptions = {}) {
    this.opts = { maxLinksPerNode: opts.maxLinksPerNode ?? 4, metricsHistoryLimit: opts.metricsHistoryLimit ?? 200 };
    this.engine = new FarmEngine(this.safeConfig(cfg));
    this.engine.allocator = (ops, agents) => {
      const plan = allocate(ops, agents, this.roles);
      this.unassigned = plan.unassigned.length;
      this.recoveries += plan.recovered > 0 ? 1 : 0;
      return plan.assignments;
    };
    this.syncRoles();
    this.topology = buildTopology(this.engine.agents, this.opts.maxLinksPerNode);
  }

  private safeConfig(cfg: FarmConfig): FarmConfig {
    const decision = enforceMode(cfg.mode);
    this.modeNotice = decision.reason;
    return { ...cfg, mode: decision.mode };
  }

  setOptions(opts: ControllerOptions) {
    this.opts = { ...this.opts, ...opts };
  }

  /** Creates role state for new agents and drops it for dead ones. */
  private syncRoles() {
    const live = new Set<string>();
    for (const a of this.engine.agents) {
      live.add(a.id);
      if (!this.roles.has(a.id)) this.roles.set(a.id, initialRoleState(a));
    }
    for (const id of [...this.roles.keys()]) if (!live.has(id)) this.roles.delete(id);
  }

  reset(cfg: FarmConfig) {
    this.engine.reset(this.safeConfig(cfg));
    this.roles.clear();
    this.metrics = null;
    this.metricsHistory = [];
    this.health = null;
    this.recoveries = 0;
    this.unassigned = 0;
    this.syncRoles();
    this.topology = buildTopology(this.engine.agents, this.opts.maxLinksPerNode);
  }

  applyConfig(cfg: FarmConfig) {
    this.engine.cfg = { ...this.engine.cfg, ...this.safeConfig(cfg) };
  }

  step(field: MeshField = NEUTRAL_MESH): ControllerState {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const before = new Map(this.engine.agents.map((a) => [a.id, a.capital]));
    const record = this.engine.step(field);
    const dur = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;

    // Lifecycle advance based on how each agent performed this cycle.
    for (const a of this.engine.agents) {
      const prev = this.roles.get(a.id) ?? initialRoleState(a);
      const { state, needsRecovery } = advanceLifecycle(prev, {
        attempted: a.stats.tasksAttempted,
        succeeded: a.stats.tasksSucceeded,
        netProfit: a.stats.netProfit,
        capital: a.capital ?? before.get(a.id) ?? 0,
      });
      if (needsRecovery) this.recoveries++;
      this.roles.set(a.id, state);
    }
    this.syncRoles();

    this.topology = adaptWeights(buildTopology(this.engine.agents, this.opts.maxLinksPerNode, field), this.engine.agents);

    if (record) {
      this.metrics = computeGenerationMetrics(record, this.engine.agents, this.metrics, dur);
      this.metricsHistory.push(this.metrics);
      if (this.metricsHistory.length > this.opts.metricsHistoryLimit) {
        this.metricsHistory.splice(0, this.metricsHistory.length - this.opts.metricsHistoryLimit);
      }
    }

    const snapshot = this.engine.snapshot();
    this.health = assessHealth({
      agents: this.engine.agents,
      roles: this.roles,
      topology: this.topology,
      metrics: this.metrics,
      field,
      halted: this.engine.halted,
      capital: snapshot.totals.capital,
    });

    return this.state(snapshot);
  }

  state(snapshot: FarmSnapshot = this.engine.snapshot()): ControllerState {
    return {
      snapshot,
      roles: new Map(this.roles),
      roleHistogram: roleHistogram(this.roles.values()),
      topology: this.topology,
      metrics: this.metrics,
      metricsHistory: [...this.metricsHistory],
      health: this.health,
      recoveries: this.recoveries,
      unassigned: this.unassigned,
      modeNotice: this.modeNotice,
    };
  }
}
