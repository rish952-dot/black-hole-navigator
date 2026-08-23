// Evolutionary Agent Farm — core domain types.
// Simulation-first: no external money, no AI credits consumed.

export type DeploymentMode =
  | "DRY_RUN"
  | "SIMULATION"
  | "PAPER_MODE"
  | "LIMITED_REAL"
  | "FULL_REAL";

export type AgentStatus = "active" | "elite" | "suspended" | "terminated";

export type TaskCategory =
  | "research"
  | "classification"
  | "coding"
  | "data-cleaning"
  | "analysis";

export type TaskSelectionStrategy = "greedy" | "roi" | "safe" | "volume" | "arbitrage";
export type PricingStrategy = "fixed" | "aggressive" | "conservative";
export type RetryPolicy = "none" | "once" | "adaptive";

export interface Genome {
  model: string;
  temperature: number;
  riskTolerance: number;          // 0..1
  minimumExpectedProfit: number;  // currency units
  maximumTaskDuration: number;    // minutes
  verificationLevel: number;      // 0..1
  researchDepth: number;          // 0..1
  parallelism: number;            // 1..8
  toolPreferences: string[];
  taskSelectionStrategy: TaskSelectionStrategy;
  pricingStrategy: PricingStrategy;
  retryPolicy: RetryPolicy;
  computeBudget: number;
}

export type TxType =
  | "initial_capital"
  | "task_payout"
  | "api_cost"
  | "compute_cost"
  | "tool_cost"
  | "transaction_fee"
  | "refund"
  | "penalty"
  | "capital_allocation"
  | "capital_withdrawal"
  | "reward";

export interface Transaction {
  id: string;
  agentId: string;
  taskId?: string;
  generation: number;
  ts: number;
  type: TxType;
  amount: number; // positive = credit to agent, negative = debit
  description: string;
}

export interface Opportunity {
  id: string;
  category: TaskCategory;
  payout: number;
  difficulty: number;      // 0..1
  durationMin: number;
  computeCost: number;
  baseSuccessProb: number; // 0..1
  requiredTools: string[];
  competition: number;     // 0..1
}

export interface TaskRecord {
  id: string;
  agentId: string;
  generation: number;
  opportunityId: string;
  category: TaskCategory;
  accepted: boolean;
  success: boolean;
  payout: number;
  cost: number;
  net: number;
  durationMin: number;
  note: string;
}

export interface AgentStats {
  revenue: number;
  costs: number;
  netProfit: number;
  roi: number;
  tasksAttempted: number;
  tasksSucceeded: number;
  tasksRejected: number;
  successRate: number;
  reliability: number;
  hoursSpent: number;
  profitPerHour: number;
  volatility: number;
  fitness: number;
  flagged: string[]; // anti-gaming flags
}

export interface Agent {
  id: string;
  parentId: string | null;
  lineage: string;     // root ancestor id
  generation: number;
  origin: "seed" | "elite" | "offspring" | "mutant" | "crossover" | "experimental" | "random";
  genome: Genome;
  capital: number;
  status: AgentStatus;
  stats: AgentStats;
  history: number[];   // fitness per generation
  events: string[];
}

export interface GenerationRecord {
  index: number;
  agents: number;
  revenue: number;
  costs: number;
  netProfit: number;
  avgFitness: number;
  bestFitness: number;
  bestAgentId: string;
  diversity: number;
  terminated: number;
  born: number;
  fitnessFormula: string;
  meshField: MeshField;
}

/** Symbiotic link with the black hole / neural mesh simulator. */
export interface MeshField {
  curvature: number;
  energyDensity: number;
  stability: number;
  anomalies: number;
}

export interface FarmConfig {
  populationSize: number;
  elitePct: number;
  survivorPct: number;
  eliminatePct: number;
  mutationRate: number;
  crossoverRate: number;
  explorationRate: number;
  startingCapital: number;
  opportunitiesPerGen: number;
  transactionFeePct: number;
  maxTaskCost: number;
  maxDailySpend: number;
  maxTotalLoss: number;
  fitnessFormula: "risk_adjusted" | "net_profit" | "roi" | "profit_per_hour" | "sharpe";
  mode: DeploymentMode;
  meshCoupling: boolean;
  seed: number;
  autonomyMinimumConfidence: number;
  autonomyRiskTolerance: number;
  autonomyMaxParallelism: number;
  autonomyAuditFrequency: number;
}

export const DEFAULT_CONFIG: FarmConfig = {
  populationSize: 100,
  elitePct: 0.1,
  survivorPct: 0.5,
  eliminatePct: 0.4,
  mutationRate: 0.25,
  crossoverRate: 0.3,
  explorationRate: 0.1,
  startingCapital: 1000,
  opportunitiesPerGen: 1000,
  transactionFeePct: 0.02,
  maxTaskCost: 400,
  maxDailySpend: 250000,
  maxTotalLoss: 150000,
  fitnessFormula: "risk_adjusted",
  mode: "SIMULATION",
  meshCoupling: true,
  seed: 42,
  autonomyMinimumConfidence: 0.85,
  autonomyRiskTolerance: 0.3,
  autonomyMaxParallelism: 2,
  autonomyAuditFrequency: 5,
};

export const NEUTRAL_MESH: MeshField = {
  curvature: 0.5,
  energyDensity: 0.5,
  stability: 0.8,
  anomalies: 0,
};
