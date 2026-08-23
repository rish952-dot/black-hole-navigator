import { FarmEngine } from "../src/farm/engine";
import { requestFarmNudge } from "../src/farm/api";
import { DEFAULT_CONFIG, NEUTRAL_MESH, type DeploymentMode } from "../src/farm/types";

const botId = Number(process.env.BOT_ID ?? "0");
const seed = Number(process.env.BOT_SEED ?? String(42 + botId));
const generations = Math.max(1, Number(process.env.GENERATIONS ?? "1"));
const populationSize = Math.max(1, Number(process.env.FARM_POPULATION ?? "10"));
const requestedMode = (process.env.DEPLOYMENT_MODE ?? "SIMULATION") as DeploymentMode;
const mode: DeploymentMode = requestedMode === "PAPER_MODE" ? "PAPER_MODE" : "SIMULATION";
const auditFrequency = Math.max(1, Number(process.env.AUTONOMY_AUDIT_FREQUENCY ?? String(DEFAULT_CONFIG.autonomyAuditFrequency)));
const aiEnabled = process.env.FARM_AI_ENABLED === "true";

const cfg = {
  ...DEFAULT_CONFIG,
  seed,
  populationSize,
  mode,
  maxDailySpend: Math.min(DEFAULT_CONFIG.maxDailySpend, Number(process.env.MAX_DAILY_SPEND ?? "50000")),
  opportunitiesPerGen: Math.max(50, Math.floor(Number(process.env.OPPORTUNITIES_PER_GEN ?? "200"))),
};

const engine = new FarmEngine(cfg);

async function main() {
  for (let i = 0; i < generations; i++) {
    const record = engine.step(NEUTRAL_MESH);
    const shouldNudge = aiEnabled && (record.index % auditFrequency === 0);

    if (!shouldNudge) continue;

    try {
      const nudge = await requestFarmNudge({
        botId,
        generation: record.index,
        seed,
        bestFitness: record.bestFitness,
        averageFitness: record.avgFitness,
        diversity: record.diversity,
        mesh: record.meshField,
      });

      if (nudge) {
        engine.cfg.mutationRate = Math.max(0, Math.min(1, engine.cfg.mutationRate + nudge.mutationDelta));
        engine.cfg.explorationRate = Math.max(0, Math.min(1, engine.cfg.explorationRate + nudge.explorationDelta));
      }
    } catch (error) {
      console.error(`[bot ${botId}] API nudge skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const snapshot = engine.snapshot();
  const latest = snapshot.generations.at(-1);
  const flagged = snapshot.agents.reduce((sum, agent) => sum + agent.stats.flagged.length, 0);
  const maxVolatility = Math.max(0, ...snapshot.agents.map((agent) => agent.stats.volatility));
  const result = {
    botId,
    seed,
    mode,
    generations,
    populationSize,
    generation: snapshot.generation,
    agents: latest?.agents ?? snapshot.agents.length,
    terminated: latest?.terminated ?? 0,
    revenue: snapshot.totals.revenue,
    costs: snapshot.totals.costs,
    netProfit: snapshot.totals.netProfit,
    capital: snapshot.totals.capital,
    diversity: snapshot.diversity,
    flagged,
    maxVolatility,
    halted: snapshot.halted,
    timestamp: new Date().toISOString(),
  };

  console.log(JSON.stringify(result, null, 2));
  await Bun.write(`farm-bot-${botId}.json`, JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(`[bot ${botId}] fatal:`, error);
  process.exit(1);
});
