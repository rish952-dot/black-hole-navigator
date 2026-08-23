import { makeProposal, type SettlementAsset } from "../src/farm/settlement";

type BotResult = {
  botId: number;
  netProfit: number;
};

const recipient = String(process.env.PAYOUT_ADDRESS ?? "").trim();
const asset = (process.env.PAYOUT_ASSET ?? "USDC") as SettlementAsset;
const minProfit = Number(process.env.MIN_PAYOUT_PROFIT ?? "1");
const share = Math.max(0, Math.min(1, Number(process.env.PAYOUT_SHARE ?? "0.5")));

if (!recipient) throw new Error("PAYOUT_ADDRESS is required");

const raw = await Bun.file(process.argv[2] ?? "farm-loop-results.json").text();
const parsed = JSON.parse(raw) as { results?: BotResult[] };
const results = parsed.results ?? [];

const proposals = results
  .filter((r) => r.netProfit > minProfit)
  .map((r) => makeProposal({
    botId: r.botId,
    recipient,
    asset,
    amount: (r.netProfit * share).toFixed(6),
    reason: `bot ${r.botId} net profit share`,
    sourceNetProfit: r.netProfit,
  }));

await Bun.write("settlement-proposals.json", JSON.stringify({
  recipient,
  asset,
  share,
  proposals,
  status: "PROPOSED_ONLY",
  note: "No blockchain transaction is signed or broadcast by this script.",
}, null, 2));

console.log(JSON.stringify({ count: proposals.length, status: "PROPOSED_ONLY" }, null, 2));
