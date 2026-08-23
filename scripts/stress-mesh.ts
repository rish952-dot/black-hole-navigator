import { encodeVector, VectorBus, rankVector, type AgentVector } from "../src/farm/vector-bus";
import { FarmEngine } from "../src/farm/engine";
import { PROFIT_FIRST_CONFIG } from "../src/farm/optimization";
import { DEFAULT_CONFIG, NEUTRAL_MESH, type Agent } from "../src/farm/types";

const nodes = Math.max(8, Math.min(128, Number(process.env.MESH_NODES ?? "64")));
const rounds = Math.max(5, Math.min(100, Number(process.env.MESH_ROUNDS ?? "20")));
const vectorsPerNode = Math.max(1, Math.min(8, Number(process.env.VECTORS_PER_NODE ?? "2")));
const busCapacity = Math.max(500, Math.min(50000, Number(process.env.MESH_BUS_CAPACITY ?? "10000")));
const aiNodes = Math.max(0, Math.min(16, Number(process.env.AI_NODES ?? "10")));
const aiConcurrency = Math.max(1, Math.min(16, Number(process.env.AI_CONCURRENCY ?? "4")));
const aiEnabled = process.env.FARM_AI_ENABLED === "true" && Boolean(process.env.FARM_AI_API_KEY && process.env.FARM_AI_BASE_URL && process.env.FARM_AI_MODEL);

const bus = new VectorBus(busCapacity);
const engines = Array.from({ length: nodes }, (_, nodeId) => new FarmEngine({
  ...DEFAULT_CONFIG,
  ...PROFIT_FIRST_CONFIG,
  seed: 5000 + nodeId,
  populationSize: 8,
  opportunitiesPerGen: 240,
  mode: "PAPER_MODE",
}));

function short(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 140);
}

function makeSyntheticVector(nodeId: number, round: number, agent: Agent): AgentVector {
  const opportunity = engines[nodeId].market.discoverTasks(1, engines[nodeId].rng)[0];
  return encodeVector(
    agent,
    opportunity,
    round,
    agent.stats.netProfit,
    agent.stats.successRate,
  );
}

async function askAi(nodeId: number, context: AgentVector): Promise<AgentVector> {
  const endpoint = `${process.env.FARM_AI_BASE_URL!.replace(/\/$/, "")}/chat/completions`;
  const compactPrompt = JSON.stringify({
    n: nodeId,
    o: context.opportunityId,
    e: +context.expectedValue.toFixed(2),
    c: +context.confidence.toFixed(3),
    cost: +context.resourceCost.toFixed(2),
    nov: +context.novelty.toFixed(3),
    urg: +context.urgency.toFixed(3),
    s: context.strategy.map((x) => +x.toFixed(3)),
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.FARM_AI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.FARM_AI_MODEL,
      temperature: 0,
      max_tokens: 120,
      messages: [
        {
          role: "system",
          content: "Use short English. Return ONLY JSON: {confidence,novelty,urgency,strategy}. Numbers 0..1. No profit claims.",
        },
        { role: "user", content: compactPrompt },
      ],
    }),
  });
  if (!response.ok) throw new Error(`AI ${nodeId} HTTP ${response.status}`);
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const raw = body.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error(`AI ${nodeId} empty response`);
  const parsed = JSON.parse(raw) as Partial<AgentVector>;
  const clamp = (n: unknown, fallback: number) => {
    const v = Number(n);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
  };
  return {
    ...context,
    sender: 10000 + nodeId,
    confidence: clamp(parsed.confidence, context.confidence),
    novelty: clamp(parsed.novelty, context.novelty),
    urgency: clamp(parsed.urgency, context.urgency),
    strategy: Array.isArray(parsed.strategy)
      ? parsed.strategy.slice(0, 5).map((x) => clamp(x, 0.5))
      : context.strategy,
  };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const started = performance.now();
let published = 0;
let peakBus = 0;
let receiveOps = 0;
let receiveVectors = 0;
let aiCalls = 0;
let aiFailures = 0;

for (let round = 0; round < rounds; round++) {
  for (let nodeId = 0; nodeId < nodes; nodeId++) {
    const engine = engines[nodeId];
    engine.step(NEUTRAL_MESH);
    const selected = engine.agents.slice(0, Math.min(engine.agents.length, vectorsPerNode));
    for (const agent of selected) {
      bus.publish(makeSyntheticVector(nodeId, round, agent));
      published++;
    }
  }

  const received = bus.receive(round);
  receiveOps += nodes;
  receiveVectors += received.length;
  peakBus = Math.max(peakBus, bus.size);

  if (aiEnabled && round % 2 === 0) {
    const seedVectors = received.slice(0, aiNodes);
    const aiResults = await mapLimit(seedVectors, aiConcurrency, async (v) => {
      aiCalls++;
      try {
        return await askAi(v.sender, v);
      } catch (error) {
        aiFailures++;
        console.log(`AI node failed: ${short(error instanceof Error ? error.message : String(error))}`);
        return v;
      }
    });
    for (const v of aiResults) bus.publish(v);
    published += aiResults.length;
  }

  bus.clearGeneration(round);
}

const elapsedMs = performance.now() - started;
const ranked = bus.receive(rounds).slice(0, 20).map(rankVector);
const result = {
  status: aiEnabled ? "AI_MESH_STRESS" : "MESH_STRESS_ONLY",
  nodes,
  rounds,
  vectorsPerNode,
  busCapacity,
  aiNodes,
  aiEnabled,
  aiConcurrency,
  aiCalls,
  aiFailures,
  publishedVectors: published,
  peakBusMessages: peakBus,
  receiveOps,
  receiveVectors,
  elapsedMs: +elapsedMs.toFixed(1),
  messagesPerSecond: +(published / Math.max(0.001, elapsedMs / 1000)).toFixed(1),
  topVectorScores: ranked.map((x) => +x.toFixed(3)),
  generatedAt: new Date().toISOString(),
};

const report = `# Mesh Stress Result

- Status: ${result.status}
- Nodes: ${nodes}
- Rounds: ${rounds}
- Vectors/node/round: ${vectorsPerNode}
- Bus capacity: ${busCapacity}
- Published vectors: ${published}
- Peak bus load: ${peakBus}
- Total receive ops: ${receiveOps}
- Total vectors received: ${receiveVectors}
- AI calls: ${aiCalls}
- AI failures: ${aiFailures}
- Elapsed: ${elapsedMs.toFixed(1)}ms
- Throughput: ${(published / Math.max(0.001, elapsedMs / 1000)).toFixed(1)} msg/s
- Top scores: ${result.topVectorScores.join(", ")}
`;

await Bun.write("mesh-stress-results.json", JSON.stringify(result, null, 2));
await Bun.write("mesh-stress-result.md", report);

const handoffNotes = "Use this result to optimize src/farm/vector-bus.ts, src/farm/api.ts, and scripts/stress-mesh.ts. Preserve compact protocol.";
await Bun.write("COPILOT_MESH_STRESS.md", report + "\n## Copilot handoff\n\n" + handoffNotes);

console.log(JSON.stringify(result, null, 2));
