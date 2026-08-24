import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { FarmEngine } from "../src/farm/engine";
import { CentralMind } from "../src/farm/central-mind";
import { DEFAULT_CONFIG, NEUTRAL_MESH, type DeploymentMode, type GenerationRecord } from "../src/farm/types";
import type { HiveNode } from "../src/farm/hive-topology";

// Live fleet daemon: runs real bot processes continuously and publishes
// honest snapshots the console UI can poll. Settlement is PAPER_MODE only —
// LIMITED_REAL/FULL_REAL stay disabled until funded secrets are provisioned.

const requestedMode = (process.env.DEPLOYMENT_MODE ?? "PAPER_MODE") as DeploymentMode;
if (requestedMode === "LIMITED_REAL" || requestedMode === "FULL_REAL") {
  throw new Error(`${requestedMode} requires FINANCE_* secrets and manual approval; refusing to start`);
}
const mode: DeploymentMode = requestedMode === "SIMULATION" ? "SIMULATION" : "PAPER_MODE";

const botCount = Math.max(1, Math.min(5, Number(process.env.BOT_COUNT ?? "5")));
const populationSize = Math.max(4, Number(process.env.FARM_POPULATION ?? "20"));
const opportunitiesPerGen = Math.max(50, Number(process.env.OPPORTUNITIES_PER_GEN ?? "500"));
const tickMs = Math.max(1000, Number(process.env.FLEET_TICK_MS ?? "5000"));
const outDir = path.resolve(process.env.FARM_LIVE_DIR ?? "public/farm-live");

// Paper payout destination. This matches the permanently allow-listed
// receive-only address in scripts/real-money-flow.ts. No transaction is
// ever signed or submitted by this daemon — proposals are bookkeeping only.
const payoutAddress = (process.env.PAYOUT_ADDRESS ?? "").trim();
const payoutAsset = (process.env.PAYOUT_ASSET ?? "USDC").toUpperCase();
const payoutShare = Math.max(0, Math.min(1, Number(process.env.PAYOUT_SHARE ?? "0.5")));
if (payoutAddress && !/^0x[a-fA-F0-9]{40}$/.test(payoutAddress)) {
  throw new Error("Invalid PAYOUT_ADDRESS: expected a 20-byte EVM address");
}

interface BotStatus {
  botId: number;
  mode: DeploymentMode;
  generation: number;
  agents: number;
  totals: { revenue: number; costs: number; netProfit: number; capital: number };
  diversity: number;
  halted: string | null;
  last: GenerationRecord | null;
  hunts: { total: number; applications: number; accepted: number; recent: { agentId: string; title: string; stage: string; accepted: boolean; revenue: number }[] };
  pathways: { synapses: number; averageWeight: number; firings: number };
  updatedAt: string;
}

const HIVES = ["queen", "specialist", "worker", "scout"] as const;

function makeNode(botId: number, i: number): HiveNode {
  return {
    id: `bot${botId}-agent-${i}`,
    role: HIVES[i % HIVES.length],
    provider: "paper",
    model: "farm-engine",
    load: 0.2,
    health: 0.9,
    state: { confidence: 0.5, novelty: 0.5, urgency: 0.5, strategy: [0.5, 0.5, 0.5, 0.5, 0.5] },
    peers: [],
    capabilities: ["research", "analysis", "coding", "classification", "data-cleaning"],
  };
}

interface Bot {
  id: number;
  engine: FarmEngine;
  mind: CentralMind;
}

const bots: Bot[] = Array.from({ length: botCount }, (_, botId) => {
  const engine = new FarmEngine({
    ...DEFAULT_CONFIG,
    seed: 7000 + botId,
    populationSize,
    opportunitiesPerGen,
    mode,
  });
  const mind = new CentralMind({ paymentMode: "paper" });
  for (let i = 0; i < 4; i++) mind.addNode(makeNode(botId, i));
  return { id: botId, engine, mind };
});

let shuttingDown = false;

function statusFor(bot: Bot): BotStatus {
  const snap = bot.engine.snapshot();
  const stats = bot.mind.pathways.stats();
  const hunts = snap.hunts;
  return {
    botId: bot.id,
    mode,
    generation: snap.generation,
    agents: snap.agents.length,
    totals: snap.totals,
    diversity: snap.diversity,
    halted: snap.halted,
    last: snap.generations[snap.generations.length - 1] ?? null,
    hunts: {
      total: hunts.length,
      applications: hunts.filter((h) => h.stage !== "skill-gap").length,
      accepted: hunts.filter((h) => h.accepted).length,
      recent: hunts.slice(0, 6).map((h) => ({ agentId: h.agentId, title: h.title, stage: h.stage, accepted: h.accepted, revenue: h.revenue })),
    },
    pathways: { synapses: stats.pathways, averageWeight: stats.averageWeight, firings: stats.totalActivations },
    updatedAt: new Date().toISOString(),
  };
}

async function publish() {
  const statuses = bots.map(statusFor);
  const proposals = statuses
    .filter((b) => b.totals.netProfit > 0)
    .map((b) => ({ botId: b.botId, amount: +(b.totals.netProfit * payoutShare).toFixed(2) }));
  const fleet = {
    mode,
    tickMs,
    startedAt,
    publishedAt: new Date().toISOString(),
    bots: statuses,
    payout: {
      status: payoutAddress ? "PAPER_ONLY" : "PAPER_ONLY_NO_DESTINATION",
      chain: "ethereum",
      address: payoutAddress || null,
      asset: payoutAsset,
      share: payoutShare,
      proposals,
      totalProposed: +proposals.reduce((s, p) => s + p.amount, 0).toFixed(2),
      transfer: {
        enabled: false,
        reason: "This daemon does not sign or submit blockchain transactions. Proposals are bookkeeping only; simulated profits are not real funds.",
      },
    },
  };
  await mkdir(outDir, { recursive: true });
  const tmp = path.join(outDir, ".fleet-status.tmp");
  await writeFile(tmp, JSON.stringify(fleet, null, 2));
  await rename(tmp, path.join(outDir, "fleet-status.json"));
}

function stepBot(bot: Bot) {
  if (bot.engine.halted) return;
  const record = bot.engine.step(NEUTRAL_MESH);
  const last = bot.engine.tasks[bot.engine.tasks.length - 1];
  bot.mind.route({
    id: `bot${bot.id}-gen-${record.index}`,
    kind: last?.category ?? "analysis",
    priority: Math.min(1, Math.max(0.1, record.avgFitness / 100)),
    requiredCapabilities: [last?.category ?? "analysis"],
    vector: {
      confidence: Math.min(1, Math.max(0, record.avgFitness / 100)),
      novelty: record.diversity,
      urgency: record.netProfit < 0 ? 0.9 : 0.4,
      strategy: [record.diversity, Math.min(1, record.born / Math.max(1, record.agents))],
    },
  });
  if (record.netProfit > 0) bot.mind.reward(`bot${bot.id}-agent-${record.index % 4}`, Math.min(100, record.netProfit / 10), `gen ${record.index} surplus`);
  if (bot.engine.halted) console.log(`[fleet] bot ${bot.id} HALTED: ${bot.engine.halted}`);
}

const startedAt = new Date().toISOString();

async function tick() {
  if (shuttingDown) return;
  for (const bot of bots) stepBot(bot);
  try {
    await publish();
  } catch (error) {
    console.error(`[fleet] publish failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function shutdown() {
  shuttingDown = true;
  await publish();
  console.log("[fleet] shutdown complete");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`[fleet] starting ${botCount} ${mode} bots · population ${populationSize} · tick ${tickMs}ms · output ${outDir}`);
await publish();
setInterval(tick, tickMs);
