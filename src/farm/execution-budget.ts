export interface ExecutionBudget {
  maxTasksPerGeneration: number;
  deadlineMs: number;
}

export const DEFAULT_EXECUTION_BUDGET: ExecutionBudget = {
  maxTasksPerGeneration: 5000,
  deadlineMs: 5000,
};

export function createExecutionBudget(overrides: Partial<ExecutionBudget> = {}): ExecutionBudget {
  return {
    maxTasksPerGeneration: Math.max(1, Math.floor(overrides.maxTasksPerGeneration ?? DEFAULT_EXECUTION_BUDGET.maxTasksPerGeneration)),
    deadlineMs: Math.max(50, Math.floor(overrides.deadlineMs ?? DEFAULT_EXECUTION_BUDGET.deadlineMs)),
  };
}

export function budgetExpired(startedAt: number, budget: ExecutionBudget): boolean {
  return Date.now() - startedAt >= budget.deadlineMs;
}
