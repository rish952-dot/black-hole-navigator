import { mkdir } from "node:fs/promises";

const address = (process.env.PAYOUT_ADDRESS ?? "").trim();
const chain = (process.env.PAYOUT_CHAIN ?? "ethereum").trim().toLowerCase();
const botCount = Math.max(0, Number(process.env.BOT_COUNT ?? "5"));

if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
  console.error("Invalid PAYOUT_ADDRESS. Expected a 20-byte EVM address such as 0x....");
  process.exit(1);
}

if (chain !== "ethereum") {
  console.error(`Unsupported payout chain: ${chain}. Paper payout reports currently support ethereum as the destination label.`);
  process.exit(1);
}

const files = Array.from({ length: botCount }, (_, botId) => `farm-bot-${botId}.json`);
let totalNetProfit = 0;
const bots: unknown[] = [];

for (const file of files) {
  try {
    const text = await Bun.file(file).text();
    const result = JSON.parse(text) as { botId?: number; netProfit?: number; revenue?: number; costs?: number };
    totalNetProfit += Number(result.netProfit ?? 0);
    bots.push(result);
  } catch {
    // Missing bot artifacts are recorded rather than silently treated as zero.
    bots.push({ file, missing: true });
  }
}

await mkdir("farm-output", { recursive: true });

const manifest = {
  status: "PAPER_ONLY",
  chain,
  payoutAddress: address,
  totalPaperNetProfit: Number(totalNetProfit.toFixed(2)),
  botCount,
  bots,
  transfer: {
    enabled: false,
    reason: "This repository does not sign or submit blockchain transactions. The manifest is a bookkeeping/output destination only.",
  },
  createdAt: new Date().toISOString(),
};

await Bun.write("farm-output/payout-manifest.json", JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
