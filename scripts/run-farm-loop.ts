import { FarmEngine } from "../src/farm/engine";
import { requestFarmNudge } from "../src/farm/api";
import { encodeVector, VectorBus } from "../src/farm/vector-bus";
import { assessFarm } from "../src/farm/farm-supervisor";
import { grossOpportunityScore, PROFIT_FIRST_CONFIG, roundRobin } from "../src/farm/optimization";
import { DEFAULT_CONFIG, NEUTRAL_MESH } from "../src/farm/types";

const bots = Math.max(1, Math.min(10, Number(process.env.BOT_COUNT ?? "5")));
const rounds = Math.max(1, Math.min(25, Number(process.env.ROUNDS ?? "15")));
const pop = Math.max(2, Math.min(30, Number(process.env.FARM_POPULATION ?? "20")));
const ops = Math.max(100, Math.min(1500, Number(process.env.OPPORTUNITIES_PER_GEN ?? String(PROFIT_FIRST_CONFIG.opportunitiesPerGen))));
const aiOn = process.env.FARM_AI_ENABLED === "true";
const auditEvery = Math.max(1, Number(process.env.AUTONOMY_AUDIT_FREQUENCY ?? "5"));

const bus = new VectorBus(4000);
const engines = Array.from({ length: bots }, (_, botId) => new FarmEngine({
  ...DEFAULT_CONFIG,
  ...PROFIT_FIRST_CONFIG,
  seed: 1000 + botId,
  populationSize: pop,
  opportunitiesPerGen: ops,
  mode: "PAPER_MODE",
}));

const early = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 120);

async function main() {
  const out: unknown[] = [];

  for (let round = 0; round < rounds; round++) {
    for (let botId = 0; botId < engines.length; botId++) {
      const engine = engines[botId];
      const record = engine.step(NEUTRAL_MESH);

      const ranked = engine.market
        .discoverTasks(Math.min(60, Math.max(12, Math.floor(ops * 0.05))), engine.rng)
        .sort((a, b) => grossOpportunityScore(b) - grossOpportunityScore(a));
      const shares = roundRobin(ranked, Math.max(1, engine.agents.length));

      engine.agents.forEach((agent, agentIndex) => {
        const best = shares[agentIndex]?.[0] ?? ranked[0];
        if (!best) return;
        const vector = encodeVector(agent, best, record.index, agent.stats.netProfit, agent.stats.successRate);
        bus.publish(vector);
      });

      const peer = bus.receive(record.index).slice(0, 12);
      for (const v of peer) {
        if (v.sender === botId) continue;
        const pressure = (v.novelty - 0.5) * 0.01 + Math.max(-0.01, Math.min(0.01, v.expectedValue / 100000));
        engine.cfg.explorationRate = Math.max(0, Math.min(1, engine.cfg.explorationRate + pressure));
      }

      if (aiOn && record.index % auditEvery === 0) {
        try {
          const nudge = await requestFarmNudge({
            botId,
            generation: record.index,
            seed: engine.cfg.seed,
            bestFitness: record.bestFitness,
            averageFitness: record.avgFitness,
            diversity: record.diversity,
            mesh: record.meshField,
          });
          if (nudge) {
            engine.cfg.mutationRate = Math.max(0, Math.min(1, engine.cfg.mutationRate + nudge.mutationDelta));
            engine.cfg.explorationRate = Math.max(0, Math.min(1, engine.cfg.explorationRate + nudge.explorationDelta));
          }
        } catch (e) {
          console.log(`AI off bot ${botId}: ${early(e instanceof Error ? e.message : String(e))}`);
        }
      }
    }

    const health = engines.map((e) => assessFarm(e.agents, e.generations, e.snapshot().totals, e.halted));
    const bad = health.filter((h) => !h.healthy).length;
    console.log(`round ${round + 1}/${rounds} bots ${bots} bad ${bad} vec ${bus.size}`);
    if (bad > Math.floor(bots / 2)) break;
  }

  for (let botId = 0; botId < engines.length; botId++) {
    const snap = engines[botId].snapshot();
    out.push({
      botId,
      gen: snap.generation,
      profit: snap.totals.netProfit,
      capital: snap.totals.capital,
      diversity: snap.diversity,
      halted: snap.halted,
    });
  }

  await Bun.write("farm-loop-results.json", JSON.stringify({
    bots,
    rounds,
    population: pop,
    opportunities: ops,
    fitness: "net_profit",
    mode: "PAPER_MODE",
    vectorMessages: bus.size,
    results: out,
    ts: new Date().toISOString(),
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
