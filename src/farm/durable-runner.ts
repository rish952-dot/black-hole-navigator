import type { FarmEngine } from "./engine";
import { assessFarm, type FarmHealth } from "./farm-supervisor";
import type { MeshField } from "./types";

export type Checkpoint = {
  workflowId: string;
  generation: number;
  status: "completed" | "failed" | "cancelled" | "halted";
  createdAt: number;
  snapshot: ReturnType<FarmEngine["snapshot"]>;
  health: FarmHealth;
  audit: string[];
};

export interface CheckpointStore {
  save(checkpoint: Checkpoint): Promise<void>;
  latest(workflowId: string): Promise<Checkpoint | null>;
}

/** Small in-memory checkpoint store; production adapters can persist the same contract. */
export class MemoryCheckpointStore implements CheckpointStore {
  private readonly entries = new Map<string, Checkpoint>();

  async save(checkpoint: Checkpoint): Promise<void> {
    this.entries.set(checkpoint.workflowId, structuredClone(checkpoint));
  }

  async latest(workflowId: string): Promise<Checkpoint | null> {
    const value = this.entries.get(workflowId);
    return value ? structuredClone(value) : null;
  }
}

export type DurableRunOptions = {
  workflowId: string;
  maxGenerations: number;
  maxDurationMs: number;
  maxConsecutiveNoProgress: number;
  maxRetriesPerGeneration: number;
  retryDelayMs: number;
  field?: MeshField;
  health?: Parameters<typeof assessFarm>[4];
};

/**
 * Bounded orchestration layer inspired by Cognitive Mesh DurableWorkflowEngine.
 * Checkpoints after every generation, retries only transient generation errors,
 * and stops explicitly on limits or supervisor failure. It never auto-resumes a
 * stopped run and never changes governing prompts/configuration at runtime.
 */
export class DurableFarmRunner {
  constructor(private readonly checkpoints: CheckpointStore = new MemoryCheckpointStore()) {}

  async run(engine: FarmEngine, options: DurableRunOptions): Promise<Checkpoint> {
    const maxGenerations = Math.max(1, Math.floor(options.maxGenerations));
    const maxDurationMs = Math.max(1, options.maxDurationMs);
    const maxNoProgress = Math.max(1, Math.floor(options.maxConsecutiveNoProgress));
    const maxRetries = Math.max(0, Math.floor(options.maxRetriesPerGeneration));
    const started = performance.now();
    let noProgress = 0;
    let lastNet = engine.snapshot().totals.netProfit;
    const audit: string[] = ["workflow.started"];

    for (let attemptGeneration = 0; attemptGeneration < maxGenerations; attemptGeneration++) {
      if (performance.now() - started >= maxDurationMs) {
        audit.push("workflow.duration_limit_reached");
        return this.checkpoint(engine, options.workflowId, "halted", audit, options.health);
      }

      let completed = false;
      let lastError: unknown;
      for (let retry = 0; retry <= maxRetries; retry++) {
        try {
          engine.step(options.field);
          completed = true;
          break;
        } catch (error) {
          lastError = error;
          if (retry < maxRetries) {
            audit.push(`generation.retry.${retry + 1}`);
            await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs * 2 ** retry));
          }
        }
      }

      if (!completed) {
        audit.push("workflow.generation_failed");
        const checkpoint = await this.checkpoint(engine, options.workflowId, "failed", audit, options.health);
        throw new Error(`Farm generation failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
      }

      const snapshot = engine.snapshot();
      const health = assessFarm(snapshot.agents, snapshot.generations, snapshot.totals, snapshot.halted, options.health);
      audit.push("workflow.generation.checkpointed");
      if (snapshot.totals.netProfit <= lastNet) noProgress++;
      else noProgress = 0;
      lastNet = snapshot.totals.netProfit;

      const checkpoint: Checkpoint = {
        workflowId: options.workflowId,
        generation: snapshot.generation,
        status: snapshot.halted ? "halted" : "completed",
        createdAt: Date.now(),
        snapshot,
        health,
        audit: [...audit],
      };
      await this.checkpoints.save(checkpoint);

      if (snapshot.halted) return checkpoint;
      if (!health.healthy) {
        audit.push("workflow.health_gate_failed");
        return this.checkpoint(engine, options.workflowId, "halted", audit, options.health);
      }
      if (noProgress >= maxNoProgress) {
        audit.push("workflow.no_progress_limit_reached");
        return this.checkpoint(engine, options.workflowId, "halted", audit, options.health);
      }
    }

    audit.push("workflow.generation_limit_reached");
    return this.checkpoint(engine, options.workflowId, "completed", audit, options.health);
  }

  /** Explicit caller-controlled inspection/resume point; this runner never auto-resumes. */
  async latest(workflowId: string): Promise<Checkpoint | null> {
    return this.checkpoints.latest(workflowId);
  }

  private async checkpoint(
    engine: FarmEngine,
    workflowId: string,
    status: Checkpoint["status"],
    audit: string[],
    healthLimits?: Parameters<typeof assessFarm>[4],
  ): Promise<Checkpoint> {
    const snapshot = engine.snapshot();
    const checkpoint: Checkpoint = {
      workflowId,
      generation: snapshot.generation,
      status,
      createdAt: Date.now(),
      snapshot,
      health: assessFarm(snapshot.agents, snapshot.generations, snapshot.totals, snapshot.halted, healthLimits),
      audit: [...audit],
    };
    await this.checkpoints.save(checkpoint);
    return checkpoint;
  }
}
