export type WorkflowLifecycle = "proposed" | "specified" | "harnessed" | "verified" | "promoted" | "restricted" | "retired";
export type RetryStrategy = "none" | "fixed" | "exponential";
export type QueuePolicy = "reject" | "queue" | "shed-low-priority";

export interface AgentWorkflowContract {
  schemaVersion: "agent-workflow-contract/v1";
  contractId: string;
  name: string;
  lifecycleState: WorkflowLifecycle;
  trigger: { type: "manual" | "api" | "event" | "schedule" | "github-workflow"; idempotencyKey: string };
  runtime: {
    timeoutMs: number;
    maxIterations: number;
    maxRetries: number;
    retryStrategy: RetryStrategy;
    baseDelayMs: number;
    maxConcurrency: number;
    queuePolicy: QueuePolicy;
    queueLimit: number;
  };
  modelRoute: { providerPolicy: "fixed" | "fallback" | "gateway-managed" | "none"; maxTokens: number };
  costRoute: { costCenter: string; budgetCapUsd: number };
  authority: { defaultScope: string; restrictedScopes: string[]; escalationPolicy: "deny" | "human-approval" | "service-policy" };
  audit: { requiredEvents: string[] };
  rollback: { strategy: "checkpoint-restore" | "replay" | "none" };
}

/** Rejects contracts that omit finite execution or cost bounds. */
export function validateAgentWorkflowContract(contract: AgentWorkflowContract): string[] {
  const errors: string[] = [];
  if (!/^agent-workflow-contract\/v1$/.test(contract.schemaVersion)) errors.push("unsupported schemaVersion");
  if (!contract.contractId.trim()) errors.push("contractId required");
  if (contract.runtime.timeoutMs <= 0) errors.push("timeoutMs must be finite and positive");
  if (contract.runtime.maxIterations <= 0) errors.push("maxIterations must be finite and positive");
  if (contract.runtime.maxRetries < 0) errors.push("maxRetries cannot be negative");
  if (contract.runtime.baseDelayMs < 0) errors.push("baseDelayMs cannot be negative");
  if (contract.runtime.maxConcurrency <= 0) errors.push("maxConcurrency must be positive");
  if (contract.runtime.queueLimit < 0) errors.push("queueLimit cannot be negative");
  if (contract.modelRoute.maxTokens <= 0) errors.push("model maxTokens must be finite and positive");
  if (contract.costRoute.budgetCapUsd < 0) errors.push("budgetCapUsd cannot be negative");
  if (contract.audit.requiredEvents.length === 0) errors.push("at least one audit event is required");
  return errors;
}
