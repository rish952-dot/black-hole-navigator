import { getAutonomyConfig } from "../src/farm/autonomy-config";
import type { FarmSnapshot } from "../src/farm/engine";

const botId = Number(process.env.BOT_ID ?? 0);
const maxAcceptableLoss = Number(process.env.MAX_ACCEPTABLE_LOSS ?? 5000);
const minDiversity = Number(process.env.MIN_DIVERSITY ?? 0.4);
const flagThreshold = Number(process.env.FLAG_THRESHOLD ?? 2);
const maxVolatility = Number(process.env.MAX_VOLATILITY ?? 0.8);
const maxDailySpend = Number(process.env.MAX_DAILY_SPEND ?? 50000);

const path = process.argv[2] ?? `farm-bot-${botId}.json`;
const raw = await Bun.file(path).text();
const snapshot = JSON.parse(raw) as FarmSnapshot;
const autonomy = getAutonomyConfig(botId);

const errors: string[] = [];
const warnings: string[] = [];

if (snapshot.totals.netProfit < -maxAcceptableLoss) {
  errors.push(`net loss ${snapshot.totals.netProfit.toFixed(2)} exceeds ${maxAcceptableLoss}`);
}
if (snapshot.totals.costs > maxDailySpend) {
  errors.push(`spend ${snapshot.totals.costs.toFixed(2)} exceeds ${maxDailySpend}`);
}
if (snapshot.diversity < minDiversity) {
  errors.push(`diversity ${snapshot.diversity.toFixed(3)} below ${minDiversity}`);
}

const latest = snapshot.generations.at(-1);
if (latest && latest.agents > 0 && latest.terminated / latest.agents > 0.4 + 1e-9) {
  errors.push(`termination rate ${((latest.terminated / latest.agents) * 100).toFixed(1)}% exceeds 40%`);
}

const flagged = snapshot.agents.reduce((sum, agent) => sum + agent.stats.flagged.length, 0);
if (flagged > flagThreshold) {
  errors.push(`anti-gaming flags ${flagged} exceed ${flagThreshold}`);
}

const maxObservedVolatility = Math.max(0, ...snapshot.agents.map((a) => a.stats.volatility));
if (maxObservedVolatility > maxVolatility) {
  errors.push(`volatility ${maxObservedVolatility.toFixed(3)} exceeds ${maxVolatility}`);
}

if (autonomy.mode === "LIMITED_REAL" || autonomy.mode === "FULL_REAL") {
  errors.push("real execution is disabled in the current simulation-first runner");
}

if (snapshot.halted) warnings.push(`engine halted: ${snapshot.halted}`);

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
