const botCount = Math.max(1, Number(process.env.BOT_COUNT ?? "5"));
const minDiversity = Number(process.env.MIN_DIVERSITY ?? "0.4");
const maxLoss = Number(process.env.MAX_ACCEPTABLE_LOSS ?? "5000");
const maxVolatility = Number(process.env.MAX_VOLATILITY ?? "0.8");
const maxFlags = Number(process.env.FLAG_THRESHOLD ?? "2");

const reports: Array<Record<string, unknown>> = [];
let failed = 0;
let totalNet = 0;

for (let botId = 0; botId < botCount; botId++) {
  const file = `farm-bot-${botId}.json`;
  try {
    const report = JSON.parse(await Bun.file(file).text()) as Record<string, unknown>;
    reports.push(report);
    totalNet += Number(report.netProfit ?? 0);

    const checks = [
      Number(report.netProfit ?? 0) >= -maxLoss,
      Number(report.diversity ?? 0) >= minDiversity,
      Number(report.maxVolatility ?? 0) <= maxVolatility,
      Number(report.flagged ?? 0) <= maxFlags,
      !report.halted,
    ];
    if (checks.some((ok) => !ok)) failed++;
  } catch {
    reports.push({ botId, missing: true });
    failed++;
  }
}

const summary = {
  status: failed === 0 ? "GREEN" : "RED",
  botCount,
  failed,
  totalPaperNetProfit: Number(totalNet.toFixed(2)),
  thresholds: { minDiversity, maxLoss, maxVolatility, maxFlags },
  reports,
  supervisedAt: new Date().toISOString(),
};

await Bun.write("farm-supervisor.json", JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));

if (failed > 0) process.exit(1);
