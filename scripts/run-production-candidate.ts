import { FarmEngine } from "../src/farm/engine";
import { CachedOpportunitySource, fetchExternalOpportunities, opportunityFeedFromEnv } from "../src/farm/opportunity-gateway";
import { assessFarm } from "../src/farm/farm-supervisor";
import { encodeVector, VectorBus } from "../src/farm/vector-bus";
import { DEFAULT_CONFIG, NEUTRAL_MESH } from "../src/farm/types";

const bots = Math.max(1, Math.min(5, Number(process.env.BOT_COUNT ?? "5")));
const rounds = Math.max(1, Math.min(20, Number(process.env.ROUNDS ?? "5")));
const opportunities = Math.max(50, Math.min(1000, Number(process.env.OPPORTUNITIES_PER_GEN ?? "500")));

async function main() {
  const feed = opportunityFeedFromEnv();
  if (!feed) throw new Error("OPPORTUNITY_FEED_URL is required for production-candidate mode");

  const source = new CachedOpportunitySource();
  const ops = await fetchExternalOpportunities(feed.url, opportunities, feed.token);
  if (ops.length === 0) throw new Error("External opportunity feed returned zero valid opportunities");
  source.setTasks(ops);

  const bus = new VectorBus(4000);
  const engines = Array.from({ length: bots }, (_, botId) => new FarmEngine({
    ...DEFAULT_CONFIG,
    seed: 7000 + botId,
    populationSize: 20,
    opportunitiesPerGen: ops.length,
    mode: "PAPER_MODE",
    fitnessFormula: "net_profit",
  }, source));

  for (let round = 0; round < rounds; round++) {
    for (let botId = 0; botId < engines.length; botId++) {
      const engine = engines[botId];
      const record = engine.step(NEUTRAL_MESH);
      const sample = ops[round % ops.length];
      for (const agent of engine.agents.slice(0, 20)) {
        bus.publish(encodeVector(agent, sample, record.index, agent.stats.netProfit, agent.stats.successRate));
      }
      for (const peer of bus.receive(record.index).slice(0, 16)) {
        if (peer.sender === botId) continue;
        engine.cfg.explorationRate = Math.max(
          0,
          Math.min(1, engine.cfg.explorationRate + (peer.novelty - 0.5) * 0.008),
        );
      }
      bus.clearGeneration(record.index);
    }
  }

  const results = engines.map((engine, botId) => {
    const snap = engine.snapshot();
    const health = assessFarm(engine.agents, engine.generations, snap.totals, snap.halted);
    return {
      botId,
      generations: snap.generation,
      revenue: snap.totals.revenue,
      costs: snap.totals.costs,
      netProfit: snap.totals.netProfit,
      diversity: snap.diversity,
      health,
      halted: snap.halted,
    };
  });

  const aggregateProfit = results.reduce((sum, x) => sum + x.netProfit, 0);
  const ranked = [...results].sort((a, b) => b.netProfit - a.netProfit);

  await Bun.write("production-candidate-results.json", JSON.stringify({
    source: "external-readonly-opportunity-feed",
    bots,
    rounds,
    opportunityCount: ops.length,
    vectorMessages: bus.size,
    aggregateProfit,
    results,
    ranked,
    timestamp: new Date().toISOString(),
    settlement: "approval-only",
    execution: "paper-only",
    nextStep: "integrate an explicitly authorized provider work adapter, then manually approve any real transaction outside the farm",
  }, null, 2));
  console.log(JSON.stringify({ bots, rounds, opportunityCount: ops.length, vectorMessages: bus.size, aggregateProfit }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
