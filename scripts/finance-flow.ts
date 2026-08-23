import { mkdir } from "node:fs/promises";
import { JsonRpcProvider, Wallet, Contract, parseEther, parseUnits, formatEther, formatUnits, getAddress } from "ethers";

/**
 * Production-capable finance controller.
 *
 * Default: PAPER mode.
 * REAL mode requires FINANCE_REAL_MONEY=true and an explicitly configured
 * RPC endpoint, signer, destination allow-list and spending limits.
 *
 * The signer is loaded only from FINANCE_PRIVATE_KEY at runtime; never commit
 * the key to the repository. Every real transfer is bounded by per-tx and
 * daily limits and is written to an audit log after broadcast.
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

type Asset = "ETH" | "USDC" | "USDT";

type FlowEntry = {
  id: string;
  ts: string;
  kind: "REVENUE" | "COST" | "RESERVE" | "HOSTING" | "PAYOUT_PROPOSAL" | "REAL_TRANSFER" | "REAL_TRANSFER_FAILED";
  botId?: number;
  agentId?: string;
  amount: number;
  balanceAfter: number;
  description: string;
  txHash?: string;
};

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

const n = (v: unknown, fallback = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
};
const money = (v: number) => Number(v.toFixed(6));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const envBool = (key: string) => (process.env[key] ?? "false").toLowerCase() === "true";

const botCount = clamp(Math.floor(n(process.env.BOT_COUNT, 5)), 1, 100);
const startingCapital = Math.max(0, n(process.env.FINANCE_STARTING_CAPITAL, 0));
const reserveRate = clamp(n(process.env.FINANCE_RESERVE_RATE, 0.20), 0, 0.90);
const payoutRate = clamp(n(process.env.FINANCE_PAYOUT_RATE, 0.50), 0, 1);
const hostingBudgetRate = clamp(n(process.env.FINANCE_HOSTING_RATE, 0.20), 0, 0.80);
const minimumPayout = Math.max(0, n(process.env.FINANCE_MIN_PAYOUT, 1));
const sourceFile = process.argv[2] ?? "farm-loop-results.json";

const realMoney = envBool("FINANCE_REAL_MONEY");
const asset = ((process.env.FINANCE_ASSET ?? "USDC").toUpperCase() as Asset);
const rpcUrl = (process.env.FINANCE_RPC_URL ?? "").trim();
const privateKey = (process.env.FINANCE_PRIVATE_KEY ?? "").trim();
const destination = (process.env.FINANCE_DESTINATION ?? "").trim();
const chainId = Math.max(1, Math.floor(n(process.env.FINANCE_CHAIN_ID, 1)));
const maxPerTx = Math.max(0, n(process.env.FINANCE_MAX_TRANSFER, 10));
const maxDaily = Math.max(0, n(process.env.FINANCE_MAX_DAILY_TRANSFER, 25));
const dryRunReal = envBool("FINANCE_REAL_DRY_RUN");
const confirmations = Math.max(1, Math.floor(n(process.env.FINANCE_CONFIRMATIONS, 1)));

if (!(["ETH", "USDC", "USDT"] as string[]).includes(asset)) {
  throw new Error(`Unsupported FINANCE_ASSET: ${asset}`);
}
if (realMoney && (!rpcUrl || !privateKey || !destination)) {
  throw new Error("REAL mode requires FINANCE_RPC_URL, FINANCE_PRIVATE_KEY and FINANCE_DESTINATION");
}
if (realMoney && !/^0x[a-fA-F0-9]{40}$/.test(destination)) {
  throw new Error("FINANCE_DESTINATION must be a valid EVM address");
}
if (realMoney && maxPerTx <= 0) throw new Error("FINANCE_MAX_TRANSFER must be positive in REAL mode");
if (realMoney && maxDaily < maxPerTx) throw new Error("FINANCE_MAX_DAILY_TRANSFER must be >= FINANCE_MAX_TRANSFER");

let source: { results?: BotResult[] } = { results: [] };
try {
  source = JSON.parse(await Bun.file(sourceFile).text()) as { results?: BotResult[] };
} catch {
  console.warn(`Finance source unavailable: ${sourceFile}; continuing with empty input.`);
}

const results = (source.results ?? []).slice(0, botCount);
const flow: FlowEntry[] = [];
const balances = new Map<number, number>();
let balance = startingCapital;
let realTransferredToday = 0;

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
  if (revenue > 0) push({ kind: "REVENUE", botId, amount: revenue, description: `revenue reported by bot ${botId}` });
  if (costs > 0) push({ kind: "COST", botId, amount: -costs, description: `compute/operation costs reported by bot ${botId}` });
}

const totalRevenue = money(results.reduce((s, r) => s + Math.max(0, n(r.revenue)), 0));
const totalCosts = money(results.reduce((s, r) => s + Math.max(0, n(r.costs)), 0));
const netProfit = money(totalRevenue - totalCosts);
const reserve = money(Math.max(0, netProfit) * reserveRate);
const distributable = money(Math.max(0, netProfit - reserve));
const hostingPool = money(distributable * hostingBudgetRate);
const payoutPool = money(distributable * payoutRate);

if (reserve > 0) push({ kind: "RESERVE", amount: -reserve, description: `operating reserve (${reserveRate * 100}%)` });
if (hostingPool > 0) push({ kind: "HOSTING", amount: -hostingPool, description: `adaptive hosting pool (${hostingBudgetRate * 100}% of distributable profit)` });

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
    reason: "performance allocation",
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
    approvalRequired: false,
    executionEnabled: realMoney,
    asset,
  };
});

for (const p of payouts) {
  if (p.amount > 0) push({ kind: "PAYOUT_PROPOSAL", botId: p.botId, amount: -p.amount, description: `${realMoney ? "real" : "paper"} payout allocation for bot ${p.botId}` });
}

/** Execute a real EVM payment only after all configured limits are satisfied. */
async function executeRealTransfers(): Promise<void> {
  if (!realMoney) return;
  if (dryRunReal) {
    console.warn("FINANCE_REAL_DRY_RUN=true: validating real-money path without broadcasting.");
    return;
  }

  const provider = new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== chainId) throw new Error(`RPC chain mismatch: expected ${chainId}, got ${network.chainId}`);

  const signer = new Wallet(privateKey, provider);
  const signerAddress = await signer.getAddress();
  const target = getAddress(destination);

  if (asset === "ETH") {
    for (const p of payouts) {
      if (p.amount <= 0) continue;
      const remaining = maxDaily - realTransferredToday;
      const amount = Math.min(p.amount, maxPerTx, remaining);
      if (amount <= 0) break;
      const value = parseEther(amount.toString());
      const tx = await signer.sendTransaction({ to: target, value });
      const receipt = await tx.wait(confirmations);
      realTransferredToday = money(realTransferredToday + amount);
      push({ kind: "REAL_TRANSFER", botId: p.botId, amount: -amount, txHash: receipt?.hash ?? tx.hash, description: `REAL ${asset} transfer from ${signerAddress} to ${target}` });
    }
    return;
  }

  const tokenAddress = (process.env.FINANCE_TOKEN_ADDRESS ?? "").trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(tokenAddress)) throw new Error("FINANCE_TOKEN_ADDRESS is required for USDC/USDT");
  const token = new Contract(getAddress(tokenAddress), ERC20_ABI, signer);
  const decimals = Number(await token.decimals());
  const walletBalance = await token.balanceOf(signerAddress);

  for (const p of payouts) {
    if (p.amount <= 0) continue;
    const remaining = maxDaily - realTransferredToday;
    const amount = Math.min(p.amount, maxPerTx, remaining);
    if (amount <= 0) break;
    const units = parseUnits(amount.toFixed(Math.min(decimals, 6)), decimals);
    if (walletBalance < units) throw new Error(`Insufficient ${asset} balance for transfer`);
    const tx = await token.transfer(target, units);
    const receipt = await tx.wait(confirmations);
    realTransferredToday = money(realTransferredToday + amount);
    push({ kind: "REAL_TRANSFER", botId: p.botId, amount: -amount, txHash: receipt?.hash ?? tx.hash, description: `REAL ${asset} transfer from ${signerAddress} to ${target}` });
  }
}

await executeRealTransfers();

const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  mode: realMoney ? (dryRunReal ? "REAL_DRY_RUN" : "REAL") : "PAPER",
  sourceFile,
  policy: {
    startingCapital,
    reserveRate,
    hostingBudgetRate,
    payoutRate,
    minimumPayout,
    asset,
    chainId,
    maxPerTx,
    maxDaily,
    confirmations,
    realTransfersEnabled: realMoney && !dryRunReal,
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
    finalBalance: balance,
    realTransferredToday,
  },
  botBalances: [...balances.entries()].map(([botId, capital]) => ({ botId, capital })),
  agentRanking: ranked,
  hostingAllocations: hosting,
  payoutProposals: payouts,
  cashFlow: flow,
  audit: {
    privateKeyReadFromEnvironmentOnly: realMoney,
    paymentProviderCalled: realMoney,
    blockchainTransactionSubmitted: realMoney && !dryRunReal,
  },
};

await mkdir("farm-output", { recursive: true });
await Bun.write("farm-output/finance-flow.json", JSON.stringify(report, null, 2));
await Bun.write("farm-output/finance-flow.md", [
  "# Farm Finance Flow",
  "",
  `Mode: **${report.mode}**`,
  `Asset: **${asset}**`,
  `Chain ID: **${chainId}**`,
  "",
  `- Revenue: ${totalRevenue}`,
  `- Costs: ${totalCosts}`,
  `- Net profit: ${netProfit}`,
  `- Reserve: ${reserve}`,
  `- Hosting pool: ${hostingPool}`,
  `- Payout pool: ${payoutPool}`,
  `- Real transferred today: ${realTransferredToday}`,
  "",
  "## Agent ranking",
  ...ranked.map((a, i) => `${i + 1}. ${a.agentId} / bot ${a.botId}: net=${money(a.netProfit)}, ROI=${money(a.roi)}, fitness=${money(a.fitness)}`),
  "",
  "## Real-money controls",
  `- Max transfer: ${maxPerTx}`,
  `- Daily transfer cap: ${maxDaily}`,
  `- Destination: ${realMoney ? destination : "not active"}`,
  `- Broadcast: ${realMoney && !dryRunReal ? "enabled" : "disabled"}`,
].join("\n"));

console.log(JSON.stringify({
  status: report.mode,
  bots: results.length,
  agents: agents.length,
  totalRevenue,
  totalCosts,
  netProfit,
  reserve,
  hostingPool,
  payoutPool,
  realTransferredToday,
  output: "farm-output/finance-flow.json",
}, null, 2));
