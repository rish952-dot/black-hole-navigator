import { screenAndAllocate, type HostingTier } from "../src/farm/hosting-screener";
import type { AgentEarnings, PaymentWallet, PaymentAsset } from "../src/farm/payment-ledger";

const walletAddress = (process.env.PAYOUT_ADDRESS ?? "").trim();
const asset = (process.env.PAYOUT_ASSET ?? "USDC") as PaymentAsset;
const payoutShare = Math.max(0, Math.min(1, Number(process.env.PAYOUT_SHARE ?? "0.5")));

const files = process.argv.slice(2).filter(Boolean);
const paths = files.length ? files : ["farm-bot-0.json", "farm-bot-1.json", "farm-bot-2.json", "farm-bot-3.json", "farm-bot-4.json"];
const earnings: AgentEarnings[] = [];

for (const path of paths) {
  const raw = await Bun.file(path).text();
  const parsed = JSON.parse(raw) as { agentEarnings?: AgentEarnings[] };
  if (Array.isArray(parsed.agentEarnings)) earnings.push(...parsed.agentEarnings);
}

const wallet: PaymentWallet | undefined = walletAddress
  ? { chain: "ethereum", address: walletAddress, asset, mode: "approval_required" }
  : undefined;

const allocations = screenAndAllocate(earnings, wallet, payoutShare);
const byTier = allocations.reduce<Record<HostingTier, number>>((acc, x) => {
  acc[x.tier] = (acc[x.tier] ?? 0) + 1;
  return acc;
}, { nano: 0, standard: 0, pro: 0, elite: 0 });

const output = {
  wallet: wallet ? { ...wallet, address: wallet.address } : null,
  payout: {
    share: payoutShare,
    execution: "approval_only",
  },
  totals: {
    agents: allocations.length,
    positiveProfitAgents: allocations.filter((x) => x.netProfit > 0).length,
    aggregateNetProfit: allocations.reduce((s, x) => s + x.netProfit, 0),
  },
  hosting: byTier,
  allocations,
  timestamp: new Date().toISOString(),
};

await Bun.write("agent-screening.json", JSON.stringify(output, null, 2));
console.log(JSON.stringify({ agents: allocations.length, profit: output.totals.aggregateNetProfit, hosting: byTier }, null, 2));
