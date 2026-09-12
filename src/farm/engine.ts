import { allocateCapital, breed, diversity, emptyStats, resetAgentIds, select, spawnSeedPopulation } from "./evolution";
import { evaluate, execute } from "./executor";
import { auditAgent, computeFitness } from "./fitness";
import { Ledger } from "./ledger";
import { SyntheticMarketplace } from "./marketplace";
import { RNG } from "./rng";
import { NEUTRAL_MESH, type Agent, type FarmConfig, type GenerationRecord, type MeshField, type Opportunity, type TaskRecord } from "./types";

export interface FarmSnapshot {
  generation: number;
  agents: Agent[];
  generations: GenerationRecord[];
  tasks: TaskRecord[];
  transactions: ReturnType<Ledger["recent"]>;
  totals: { revenue: number; costs: number; netProfit: number; capital: number };
  diversity: number;
  halted: string | null;
}

/**
 * Deterministic, sandboxed evolution engine. No network, no real money:
 * everything runs against the synthetic marketplace.
 */
export class FarmEngine {
  cfg: FarmConfig;
  rng: RNG;
  ledger = new Ledger();
  market = new SyntheticMarketplace();
  agents: Agent[] = [];
  generations: GenerationRecord[] = [];
  tasks: TaskRecord[] = [];
  generation = 0;
  halted: string | null = null;
  /** Optional role-aware task allocator installed by the controller. */
  allocator: ((ops: Opportunity[], agents: Agent[]) => Map<string, Opportunity[]>) | null = null;
  private totalRevenue = 0;
  private totalCosts = 0;

  constructor(cfg: FarmConfig) {
    this.cfg = cfg;
    this.rng = new RNG(cfg.seed);
    this.reset(cfg);
  }

  reset(cfg: FarmConfig = this.cfg) {
    this.cfg = cfg;
    this.rng = new RNG(cfg.seed);
    this.ledger = new Ledger();
    this.market = new SyntheticMarketplace();
    this.generations = [];
    this.tasks = [];
    this.generation = 0;
    this.halted = null;
    this.totalRevenue = 0;
    this.totalCosts = 0;
    resetAgentIds();
    this.agents = spawnSeedPopulation(cfg, this.rng);
    for (const a of this.agents) {
      this.ledger.record(a.id, 0, "initial_capital", a.capital, "seed capital");
    }
  }

  /** Runs one full generation: discover -> evaluate -> execute -> score -> evolve. */
  step(field: MeshField = NEUTRAL_MESH): GenerationRecord {
    if (this.halted) return this.generations[this.generations.length - 1];
    const cfg = this.cfg;
    const ops = this.market.discoverTasks(cfg.opportunitiesPerGen, this.rng);

    let genRevenue = 0;
    let genCosts = 0;

    for (const a of this.agents) {
      a.stats = { ...emptyStats(), flagged: [] };
    }

    // Opportunity offering. An optional allocator (role/lifecycle aware) may
    // override the default round-robin slicing; behaviour is identical when
    // no allocator is installed.
    const perAgent = Math.max(1, Math.floor(ops.length / Math.max(1, this.agents.length)));
    const plan = this.allocator ? this.allocator(ops, this.agents) : null;
    this.agents.forEach((a, idx) => {
      const slice = plan ? (plan.get(a.id) ?? []) : ops.slice(idx * perAgent, idx * perAgent + perAgent);
      const nets: number[] = [];
      let offered = 0;
      for (const op of slice) {
        offered++;
        const ev = evaluate(a, op, cfg);
        if (!ev.accept) {
          a.stats.tasksRejected++;
          continue;
        }
        const rec = execute(a, op, ev, cfg, this.rng);
        this.tasks.push(rec);
        a.stats.tasksAttempted++;
        if (rec.success) a.stats.tasksSucceeded++;
        a.stats.revenue += rec.payout;
        a.stats.costs += rec.cost;
        a.stats.hoursSpent += rec.durationMin / 60;
        a.capital = +(a.capital + rec.net).toFixed(2);
        nets.push(rec.net);
        genRevenue += rec.payout;
        genCosts += rec.cost;
        if (rec.payout) this.ledger.record(a.id, this.generation, "task_payout", rec.payout, `${rec.category} payout`, rec.id);
        if (rec.cost) this.ledger.record(a.id, this.generation, "compute_cost", -rec.cost, `${rec.category} cost`, rec.id);
        if (a.capital <= 0) {
          a.status = "suspended";
          a.events.push(`gen${this.generation}: bankrupt`);
          break;
        }
      }

      const s = a.stats;
      s.netProfit = +(s.revenue - s.costs).toFixed(2);
      s.roi = s.costs > 0 ? +(s.netProfit / s.costs).toFixed(3) : 0;
      s.successRate = s.tasksAttempted ? +(s.tasksSucceeded / s.tasksAttempted).toFixed(3) : 0;
      s.reliability = +(0.35 + s.successRate * 0.65).toFixed(3);
      s.profitPerHour = s.hoursSpent > 0 ? +(s.netProfit / s.hoursSpent).toFixed(2) : 0;
      s.volatility = variance(nets);
      s.flagged = auditAgent(a, offered);
      s.fitness = computeFitness(s, cfg.fitnessFormula);
      a.history.push(s.fitness);
    });

    this.totalRevenue += genRevenue;
    this.totalCosts += genCosts;

    const ranked = [...this.agents].sort((x, y) => y.stats.fitness - x.stats.fitness);
    const div = diversity(this.agents);
    const record: GenerationRecord = {
      index: this.generation,
      agents: this.agents.length,
      revenue: +genRevenue.toFixed(2),
      costs: +genCosts.toFixed(2),
      netProfit: +(genRevenue - genCosts).toFixed(2),
      avgFitness: +(ranked.reduce((s, a) => s + a.stats.fitness, 0) / Math.max(1, ranked.length)).toFixed(2),
      bestFitness: ranked[0]?.stats.fitness ?? 0,
      bestAgentId: ranked[0]?.id ?? "-",
      diversity: div,
      terminated: 0,
      born: 0,
      fitnessFormula: cfg.fitnessFormula,
      meshField: { ...field },
    };

    // Safety circuit breakers.
    const netTotal = this.totalRevenue - this.totalCosts;
    if (netTotal < -cfg.maxTotalLoss) this.halted = `max total loss exceeded (${netTotal.toFixed(0)})`;
    if (genCosts > cfg.maxDailySpend) this.halted = `daily spend cap exceeded (${genCosts.toFixed(0)})`;

    const sel = select(ranked, cfg);
    for (const t of sel.terminated) {
      t.status = "terminated";
      t.events.push(`gen${this.generation}: terminated`);
    }
    record.terminated = sel.terminated.length;

    if (!this.halted) {
      this.generation++;
      const bred = breed(sel, cfg, this.rng, this.generation, field, div);
      record.born = bred.agents.length;
      this.agents = bred.agents;
      allocateCapital(this.agents, cfg.startingCapital * cfg.populationSize);
      for (const a of this.agents) {
        this.ledger.record(a.id, this.generation, "capital_allocation", a.capital, `allocated (${a.origin})`);
      }
    }

    if (this.tasks.length > 6000) this.tasks.splice(0, this.tasks.length - 6000);
    this.generations.push(record);
    return record;
  }

  snapshot(): FarmSnapshot {
    return {
      generation: this.generation,
      agents: this.agents,
      generations: this.generations,
      tasks: this.tasks.slice(-300).reverse(),
      transactions: this.ledger.recent(120),
      totals: {
        revenue: +this.totalRevenue.toFixed(2),
        costs: +this.totalCosts.toFixed(2),
        netProfit: +(this.totalRevenue - this.totalCosts).toFixed(2),
        capital: +this.agents.reduce((s, a) => s + a.capital, 0).toFixed(2),
      },
      diversity: diversity(this.agents),
      halted: this.halted,
    };
  }
}

function variance(v: number[]): number {
  if (v.length < 2) return 0;
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length);
  return +(sd / (Math.abs(m) + 50)).toFixed(3);
}
