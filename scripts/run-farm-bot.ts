import { FarmEngine } from "../src/farm/engine";
import { requestFarmNudge } from "../src/farm/api";
import { DEFAULT_CONFIG, NEUTRAL_MESH } from "../src/farm/types";

const botId = Number(process.env.BOT_ID ?? "0");
const seed = Number(process.env.BOT_SEED ?? String(42 + botId));
const generations = Math.max(1, Number(process.env.GENERATIONS ?? "1"));
const populationSize = Math.max(1, Number(process.env.FARM_POPULATION ?? "10"));

const cfg = {
  ...DEFAULT_CONFIG,
  seed,
  populationSize,
  opportunitiesPerGen: Math.max(50, Math.floor(Number(process.env.OPPORTUNITIES_PER_GEN ?? "200"))),
};

const engine = new FarmEngine(cfg);

async function main() {
  for (let i = 0; i < generations; i++) {
    const record = engine.step(NEUTRAL_MESH);

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
  const result = {
    botId,
    seed,
    generations,
    populationSize,
    generation: snapshot.generation,
    revenue: snapshot.totals.revenue,
    costs: snapshot.totals.costs,
    netProfit: snapshot.totals.netProfit,
    capital: snapshot.totals.capital,
    diversity: snapshot.diversity,
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
