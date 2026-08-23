import { getAutonomyConfig } from "../src/farm/autonomy-config";

type FarmBotResult = {
  botId: number;
  mode: string;
  agents: number;
  terminated: number;
  costs: number;
  netProfit: number;
  diversity: number;
  flagged: number;
  maxVolatility: number;
  halted: string | null;
};

const botId = Number(process.env.BOT_ID ?? 0);
const maxAcceptableLoss = Number(process.env.MAX_ACCEPTABLE_LOSS ?? 5000);
const minDiversity = Number(process.env.MIN_DIVERSITY ?? 0.4);
const flagThreshold = Number(process.env.FLAG_THRESHOLD ?? 2);
const maxVolatility = Number(process.env.MAX_VOLATILITY ?? 0.8);
const maxDailySpend = Number(process.env.MAX_DAILY_SPEND ?? 50000);

const path = process.argv[2] ?? `farm-bot-${botId}.json`;
const result = JSON.parse(await Bun.file(path).text()) as FarmBotResult;
const autonomy = getAutonomyConfig(botId);
const errors: string[] = [];
const warnings: string[] = [];

if (result.netProfit < -maxAcceptableLoss) {
  errors.push(`net loss ${result.netProfit.toFixed(2)} exceeds ${maxAcceptableLoss}`);
}
if (result.costs > maxDailySpend) {
  errors.push(`spend ${result.costs.toFixed(2)} exceeds ${maxDailySpend}`);
}
if (result.diversity < minDiversity) {
  errors.push(`diversity ${result.diversity.toFixed(3)} below ${minDiversity}`);
}
if (result.agents > 0 && result.terminated / result.agents > 0.4 + 1e-9) {
  errors.push(`termination rate ${((result.terminated / result.agents) * 100).toFixed(1)}% exceeds 40%`);
}
if (result.flagged > flagThreshold) {
  errors.push(`anti-gaming flags ${result.flagged} exceed ${flagThreshold}`);
}
if (result.maxVolatility > maxVolatility) {
  errors.push(`volatility ${result.maxVolatility.toFixed(3)} exceeds ${maxVolatility}`);
}
if (autonomy.mode === "LIMITED_REAL" || autonomy.mode === "FULL_REAL") {
  errors.push("real execution is disabled in the simulation-first runner");
}
if (result.halted) warnings.push(`engine halted: ${result.halted}`);

const report = {
  botId,
  safe: errors.length === 0,
  mode: autonomy.mode,
  errors,
  warnings,
  limits: { maxAcceptableLoss, minDiversity, flagThreshold, maxVolatility, maxDailySpend },
};

console.log(JSON.stringify(report, null, 2));
if (errors.length > 0) process.exit(1);
