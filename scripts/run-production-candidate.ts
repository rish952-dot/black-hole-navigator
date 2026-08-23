import { FarmEngine } from "../src/farm/engine";
import { CachedOpportunitySource, fetchExternalOpportunities, opportunityFeedFromEnv } from "../src/farm/opportunity-gateway";
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

  const results: unknown[] = [];
  for (let botId = 0; botId < bots; botId++) {
    const engine = new FarmEngine({
      ...DEFAULT_CONFIG,
      seed: 7000 + botId,
      populationSize: 20,
      opportunitiesPerGen: ops.length,
      mode: "PAPER_MODE",
      fitnessFormula: "net_profit",
    }, source);

    for (let round = 0; round < rounds; round++) engine.step(NEUTRAL_MESH);
    const snap = engine.snapshot();
    results.push({
      botId,
      generations: snap.generation,
      revenue: snap.totals.revenue,
      costs: snap.totals.costs,
      netProfit: snap.totals.netProfit,
      diversity: snap.diversity,
      halted: snap.halted,
    });
  }

  const aggregateProfit = results.reduce((sum, x) => sum + Number((x as { netProfit?: number }).netProfit ?? 0), 0);
  await Bun.write("production-candidate-results.json", JSON.stringify({
    source: "external-readonly-opportunity-feed",
    bots,
    rounds,
    opportunityCount: ops.length,
    aggregateProfit,
    results,
    timestamp: new Date().toISOString(),
    settlement: "approval-only",
    execution: "paper-only",
  }, null, 2));
  console.log(JSON.stringify({ bots, rounds, opportunityCount: ops.length, aggregateProfit }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
