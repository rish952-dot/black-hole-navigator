import type { DeploymentMode, TaskCategory } from "./types";

export interface BotAutonomyConfig {
  botId: number;
  mode: DeploymentMode;
  allowedCategories: TaskCategory[];
  minSuccessProbability: number;
  maxCompute: number;
  maxRetries: number;
  maxParallelism: number;
  escalateToReview: boolean;
}

const SAFE_CATEGORIES: TaskCategory[] = ["research", "classification", "data-cleaning", "analysis"];

export const AUTONOMY_CONFIGS: Record<number, BotAutonomyConfig> = Object.fromEntries(
  Array.from({ length: 10 }, (_, botId) => [botId, {
    botId,
    // Real external execution is intentionally not enabled by this config.
    mode: "PAPER_MODE" as const,
    allowedCategories: [...SAFE_CATEGORIES],
    minSuccessProbability: botId === 0 ? 0.85 : 0.75,
    maxCompute: botId === 0 ? 5000 : 3000,
    maxRetries: botId === 0 ? 1 : 0,
    maxParallelism: 2,
    escalateToReview: true,
  } satisfies BotAutonomyConfig]),
);

export function getAutonomyConfig(botId: number): BotAutonomyConfig {
  return AUTONOMY_CONFIGS[botId] ?? {
    botId,
    mode: "SIMULATION",
    allowedCategories: [...SAFE_CATEGORIES],
    minSuccessProbability: 0.75,
    maxCompute: 3000,
    maxRetries: 0,
    maxParallelism: 2,
    escalateToReview: true,
  };
}
