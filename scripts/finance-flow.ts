import { mkdir } from "node:fs/promises";

/**
 * Finance-flow controller for the evolutionary farm.
 *
 * This module is deliberately PAPER_ONLY: it accounts for bot revenue/costs,
 * reserves capital, ranks agents, creates hosting allocations and payout
 * proposals, and writes an auditable cash-flow report. It never signs,
 * broadcasts, withdraws, deposits, or moves real funds.
 */

type BotAgent = {
  agentId?: string;
  grossRevenue?: number;
  computeCost?: number;
  otherCost?: number;
  netProfit?: number;
  roi?: number;
  tasksCompleted?: number;
  fitness?: number;
  status?: string;
};

type BotResult = {
  botId?: number;
  revenue?: number;
  costs?: number;
  netProfit?: number;
  capital?: number;
  agentEarnings?: BotAgent[];
};

type FlowEntry = {
  id: string;
  ts: string;
  kind: "REVENUE" | "COST" | "RESERVE" | "HOSTING" | "PAYOUT_PROPOSAL";
  botId?: number;
  agentId?: string;
  amount: number;
  balanceAfter: number;
  description: string;
};

const n = (v: unknown, fallback = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
};
const money = (v: number) => Number(v.toFixed(6));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const botCount = clamp(Math.floor(n(process.env.BOT_COUNT, 5)), 1, 100);
const startingCapital = Math.max(0, n(process.env.FINANCE_STARTING_CAPITAL, 0));
const reserveRate = clamp(n(process.env.FINANCE_RESERVE_RATE, 0.20), 0, 0.90);
const payoutRate = clamp(n(process.env.FINANCE_PAYOUT_RATE, 0.50), 0, 1);
const hostingBudgetRate = clamp(n(process.env.FINANCE_HOSTING_RATE, 0.20), 0, 0.80);
const minimumPayout = Math.max(0, n(process.env.FINANCE_MIN_PAYOUT, 1));
const sourceFile = process.argv[2] ?? "farm-loop-results.json";

let source: { results?: BotResult[] } = { results: [] };
try {
  source = JSON.parse(await Bun.file(sourceFile).text()) as { results?: BotResult[] };
} catch {
  // Missing farm output is valid: produce an empty, auditable finance report.
}

const results = (source.results ?? []).slice(0, botCount);
const flow: FlowEntry[] = [];
const balances = new Map<number, number>();
let balance = startingCapital;

const push = (entry: Omit<FlowEntry, "id" | "ts" | "balanceAfter">) => {
  balance = money(balance + entry.amount);
  flow.push({
    ...entry,
    id: `flow_${String(flow.length + 1).padStart(6, "0")}`,
    ts: new Date().toISOString(),
    balanceAfter: balance,
  });
};

for (const r of results) {
  const botId = Math.max(0, Math.floor(n(r.botId)));
  const revenue = Math.max(0, n(r.revenue));
  const costs = Math.max(0, n(r.costs));
  balances.set(botId, money(n(r.capital)));

  if (revenue > 0) push({ kind: "REVENUE", botId, amount: revenue, description: `paper revenue reported by bot ${botId}` });
  if (costs > 0) push({ kind: "COST", botId, amount: -costs, description: `paper compute/operation costs reported by bot ${botId}` });
}

const totalRevenue = money(results.reduce((s, r) => s + Math.max(0, n(r.revenue)), 0));
const totalCosts = money(results.reduce((s, r) => s + Math.max(0, n(r.costs)), 0));
const netProfit = money(totalRevenue - totalCosts);
const reserve = money(Math.max(0, netProfit) * reserveRate);
const distributable = money(Math.max(0, netProfit - reserve));
const hostingPool = money(distributable * hostingBudgetRate);
const payoutPool = money(distributable * payoutRate);

if (reserve > 0) push({ kind: "RESERVE", amount: -reserve, description: `paper operating reserve (${reserveRate * 100}%)` });
if (hostingPool > 0) push({ kind: "HOSTING", amount: -hostingPool, description: `paper adaptive hosting pool (${hostingBudgetRate * 100}% of distributable profit)` });

const agents = results.flatMap((r) => (r.agentEarnings ?? []).map((a) => ({
  botId: Math.max(0, Math.floor(n(r.botId))),
  agentId: String(a.agentId ?? "unknown"),
  netProfit: n(a.netProfit),
  roi: n(a.roi),
  fitness: n(a.fitness),
  tasksCompleted: Math.max(0, Math.floor(n(a.tasksCompleted))),
  status: String(a.status ?? "unknown"),
})));

const ranked = [...agents].sort((a, b) => b.netProfit - a.netProfit || b.fitness - a.fitness);
const positiveProfit = ranked.filter((a) => a.netProfit > 0);
const profitSum = positiveProfit.reduce((s, a) => s + a.netProfit, 0);

const hosting = ranked.map((a, index) => {
  const share = profitSum > 0 && a.netProfit > 0 ? a.netProfit / profitSum : 0;
  const tier = index === 0 && a.netProfit > 0 ? "ELITE" : index < Math.max(1, Math.ceil(ranked.length * 0.25)) ? "PREMIUM" : "STANDARD";
  return {
    botId: a.botId,
    agentId: a.agentId,
    tier,
    allocation: money(hostingPool * share),
    performanceShare: money(share),
    reason: "paper performance allocation; no cloud account is changed",
  };
});

const payouts = results.map((r) => {
  const botId = Math.max(0, Math.floor(n(r.botId)));
  const profit = Math.max(0, n(r.netProfit));
  const amount = money(Math.min(profit * payoutRate, payoutPool));
  return {
    botId,
    amount: amount >= minimumPayout ? amount : 0,
    status: amount >= minimumPayout ? "PROPOSED" : "BELOW_MINIMUM",
    approvalRequired: true,
    executionEnabled: false,
    reason: "paper settlement proposal only; no transaction is signed or broadcast",
  };
});

for (const p of payouts) {
  if (p.amount > 0) push({ kind: "PAYOUT_PROPOSAL", botId: p.botId, amount: -p.amount, description: `paper payout proposal for bot ${p.botId}` });
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  mode: "PAPER_ONLY",
  sourceFile,
  policy: {
    startingCapital,
    reserveRate,
    hostingBudgetRate,
    payoutRate,
    minimumPayout,
    realTransfersEnabled: false,
    signingEnabled: false,
    withdrawalEnabled: false,
  },
  summary: {
    botsProcessed: results.length,
    agentsProcessed: agents.length,
    totalRevenue,
    totalCosts,
    netProfit,
    reserve,
    hostingPool,
    payoutPool,
    finalPaperBalance: balance,
  },
  botBalances: [...balances.entries()].map(([botId, capital]) => ({ botId, capital })),
  agentRanking: ranked,
  hostingAllocations: hosting,
  payoutProposals: payouts,
  cashFlow: flow,
  audit: {
    invariant: "paper ledger only",
    noRealMoneyMovement: true,
    noPrivateKeysRead: true,
    noPaymentProviderCalled: true,
    noBlockchainTransactionSubmitted: true,
  },
};

await mkdir("farm-output", { recursive: true });
await Bun.write("farm-output/finance-flow.json", JSON.stringify(report, null, 2));
await Bun.write("farm-output/finance-flow.md", [
  "# Farm Finance Flow",
  "",
  "Mode: **PAPER_ONLY**",
  "",
  `- Revenue: ${totalRevenue}`,
  `- Costs: ${totalCosts}`,
  `- Net profit: ${netProfit}`,
  `- Reserve: ${reserve}`,
  `- Hosting pool: ${hostingPool}`,
  `- Payout proposal pool: ${payoutPool}`,
  `- Final paper balance: ${balance}`,
  "",
  "## Agent ranking",
  ...ranked.map((a, i) => `${i + 1}. ${a.agentId} / bot ${a.botId}: net=${money(a.netProfit)}, ROI=${money(a.roi)}, fitness=${money(a.fitness)}`),
  "",
  "## Execution boundary",
  "All balances, hosting allocations and payouts are bookkeeping/proposals only. No payment, wallet, withdrawal, signing, or blockchain operation is performed by this file.",
].join("\n"));

console.log(JSON.stringify({
  status: "PAPER_ONLY",
  bots: results.length,
  agents: agents.length,
  totalRevenue,
  totalCosts,
  netProfit,
  reserve,
  hostingPool,
  payoutPool,
  finalPaperBalance: balance,
  output: "farm-output/finance-flow.json",
}, null, 2));
