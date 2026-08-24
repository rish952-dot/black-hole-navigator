import { allocateCapital, breed, diversity, emptyStats, resetAgentIds, select, spawnSeedPopulation } from "./evolution";
import { evaluate, execute } from "./executor";
import { auditAgent, computeFitness } from "./fitness";
import { buildJobPath } from "./job-pathways";
import { SyntheticJobBoard } from "./job-market";
import { Ledger } from "./ledger";
import { SyntheticMarketplace, type OpportunitySource } from "./marketplace";
import { RNG } from "./rng";
import { NEUTRAL_MESH, type Agent, type FarmConfig, type GenerationRecord, type HuntRecord, type MeshField, type TaskRecord } from "./types";

export interface FarmSnapshot {
  generation: number;
  agents: Agent[];
  generations: GenerationRecord[];
  tasks: TaskRecord[];
  hunts: HuntRecord[];
  transactions: ReturnType<Ledger["recent"]>;
  totals: { revenue: number; costs: number; netProfit: number; capital: number };
  diversity: number;
  halted: string | null;
}

export class FarmEngine {
  cfg: FarmConfig;
  rng: RNG;
  ledger = new Ledger();
  market: OpportunitySource;
  agents: Agent[] = [];
  generations: GenerationRecord[] = [];
  tasks: TaskRecord[] = [];
  hunts: HuntRecord[] = [];
  generation = 0;
  halted: string | null = null;
  private totalRevenue = 0;
  private totalCosts = 0;
  private readonly defaultMarket: OpportunitySource = new SyntheticMarketplace();
  private jobBoard!: SyntheticJobBoard;

  constructor(cfg: FarmConfig, market?: OpportunitySource) {
    this.cfg = cfg;
    this.market = market ?? this.defaultMarket;
    this.rng = new RNG(cfg.seed);
    this.reset(cfg);
  }

  reset(cfg: FarmConfig = this.cfg) {
    this.cfg = cfg;
    this.rng = new RNG(cfg.seed);
    this.ledger = new Ledger();
    this.market = this.market ?? this.defaultMarket;
    this.generations = [];
    this.tasks = [];
    this.hunts = [];
    this.generation = 0;
    this.halted = null;
    this.totalRevenue = 0;
    this.totalCosts = 0;
    resetAgentIds();
    this.jobBoard = new SyntheticJobBoard(this.rng);
    this.agents = spawnSeedPopulation(cfg, this.rng);
    for (const a of this.agents) {
      this.ledger.record(a.id, 0, "initial_capital", a.capital, "seed capital");
    }
  }

  setOpportunitySource(market: OpportunitySource): void {
    this.market = market;
  }

  step(field: MeshField = NEUTRAL_MESH): GenerationRecord {
    if (this.halted) return this.generations[this.generations.length - 1];
    const cfg = this.cfg;
    const ops = this.market.discoverTasks(cfg.opportunitiesPerGen, this.rng);
    let genRevenue = 0;
    let genCosts = 0;

    for (const a of this.agents) a.stats = { ...emptyStats(), flagged: [] };

    const agentCount = Math.max(1, this.agents.length);
    const perAgent = Math.max(1, Math.floor(ops.length / agentCount));

    this.agents.forEach((a, idx) => {
      const start = idx * perAgent;
      const end = Math.min(start + perAgent, ops.length);
      const nets: number[] = [];
      let offered = 0;

      for (let opIdx = start; opIdx < end; opIdx++) {
        const op = ops[opIdx];
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

    // Active job hunting: agents discover postings, match against their
    // genome skills, apply through the job board adapter, and bring home
    // revenue on accepted contracts.
    const active = this.agents.filter((a) => a.status !== "suspended");
    const huntRecords = this.runHunts(active);
    this.hunts.push(...huntRecords);
    if (this.hunts.length > 2000) this.hunts.splice(0, this.hunts.length - 2000);
    const huntStats = {
      hunts: huntRecords.length,
      applications: huntRecords.filter((h) => h.stage !== "skill-gap").length,
      accepted: huntRecords.filter((h) => h.accepted).length,
    };

    const netTotal = this.totalRevenue - this.totalCosts;
    if (netTotal < -cfg.maxTotalLoss) this.halted = `max total loss exceeded (${netTotal.toFixed(0)})`;
    if (genCosts > cfg.maxDailySpend) this.halted = `daily spend cap exceeded (${genCosts.toFixed(0)})`;

    const record = this.finishGeneration(field, huntStats);

    if (this.tasks.length > 6000) this.tasks.splice(0, this.tasks.length - 6000);
    return record;
  }

  private runHunts(active: Agent[]): HuntRecord[] {
    const jobs = this.jobBoard.discoverJobs(Math.max(this.cfg.huntsPerAgent * 2, Math.ceil(active.length * 0.5)));
    const records: HuntRecord[] = [];
    for (const agent of active) {
      if (agent.capital <= 0) continue;
      for (let h = 0; h < this.cfg.huntsPerAgent; h++) {
        const profile = {
          agentId: agent.id,
          skills: agent.genome.toolPreferences,
          remotePreferred: true,
          minimumCompensation: agent.genome.minimumExpectedProfit,
        };
        const paths = jobs.map((job) => ({ job, path: buildJobPath(profile, job) })).sort((a, b) => b.path.score - a.path.score);
        const best = paths[0];
        if (!best) break;
        const { job, path } = best;
        const applicationCost = +Math.min(agent.capital * 0.05, 5 + this.rng.next() * 15).toFixed(2);
        agent.capital = +(agent.capital - applicationCost).toFixed(2);
        this.totalCosts += applicationCost;
        this.ledger.record(agent.id, 0, "compute_cost", -applicationCost, `job application: ${job.title}`);

        if (path.stage === "skill-gap") {
          records.push({ agentId: agent.id, jobId: job.id, title: job.title, stage: "skill-gap", score: path.score, accepted: false, revenue: 0 });
          continue;
        }

        const compensation = job.compensation ?? 0;
        const receipt = this.jobBoard.settle({
          opportunity: {
            id: job.id,
            category: "research",
            payout: compensation,
            difficulty: Math.max(0.05, 1 - path.score),
            durationMin: 30,
            computeCost: applicationCost,
            baseSuccessProb: Math.min(0.95, 0.3 + path.score * 0.6),
            requiredTools: job.skills,
            competition: 0.5,
          },
          agentId: agent.id,
          payload: { matchScore: path.score, title: job.title },
        });

        if (receipt.accepted) {
          const revenue = receipt.revenue ?? 0;
          agent.capital = +(agent.capital + revenue).toFixed(2);
          this.totalRevenue += revenue;
          this.ledger.record(agent.id, 0, "task_payout", revenue, `job completed: ${job.title}`);
          records.push({ agentId: agent.id, jobId: job.id, title: job.title, stage: "outcome", score: path.score, accepted: true, revenue, receiptId: receipt.providerTaskId });
        } else {
          records.push({ agentId: agent.id, jobId: job.id, title: job.title, stage: "follow-up", score: path.score, accepted: false, revenue: 0, receiptId: receipt.providerTaskId });
        }
      }
    }
    return records;
  }

  private finishGeneration(field: MeshField, huntStats: { hunts: number; applications: number; accepted: number }): GenerationRecord {
    const genIndex = this.generation;
    const ranked = [...this.agents].sort((a, b) => b.stats.fitness - a.stats.fitness);
    const cullN = Math.round(ranked.length * this.cfg.cullPct);
    const cloneN = Math.max(1, Math.round(ranked.length * this.cfg.clonePct));
    const culled = ranked.slice(-cullN);
    const cloneSources = ranked.slice(0, cloneN);
    for (const a of culled) a.status = "terminated";
    const survivors = ranked.slice(0, ranked.length - cullN);

    const sel = select(survivors, this.cfg);
    const next = breed(sel, this.cfg, this.rng, genIndex + 1, field, diversity(this.agents));
    let replaced = 0;
    for (let i = 0; i < next.agents.length && replaced < culled.length; i++) {
      if (next.agents[i].origin === "elite") {
        const src = cloneSources[replaced % cloneSources.length];
        next.agents[i] = {
          ...next.agents[i],
          genome: { ...src.genome, toolPreferences: [...src.genome.toolPreferences] },
          parentId: src.id,
          lineage: src.lineage,
          events: [`cloned from top agent ${src.id} (bottom-40% cull replacement)`],
        };
        replaced++;
      }
    }

    allocateCapital(next.agents, this.cfg.startingCapital * next.agents.length);
    this.agents = next.agents;
    this.generation = genIndex + 1;

    const best = ranked[0];
    const avgFitness = ranked.reduce((s, a) => s + a.stats.fitness, 0) / Math.max(1, ranked.length);
    const record: GenerationRecord = {
      index: genIndex,
      agents: ranked.length,
      revenue: +ranked.reduce((s, a) => s + a.stats.revenue, 0).toFixed(2),
      costs: +ranked.reduce((s, a) => s + a.stats.costs, 0).toFixed(2),
      netProfit: +ranked.reduce((s, a) => s + a.stats.netProfit, 0).toFixed(2),
      avgFitness: +avgFitness.toFixed(2),
      bestFitness: +best.stats.fitness.toFixed(2),
      bestAgentId: best.id,
      diversity: +diversity(this.agents).toFixed(3),
      terminated: culled.length,
      born: next.stats.offspring + next.stats.mutants + next.stats.crossovers + next.stats.experimental + next.stats.random,
      fitnessFormula: this.cfg.fitnessFormula,
      meshField: field,
      hunts: huntStats.hunts,
      applications: huntStats.applications,
      accepted: huntStats.accepted,
      cloned: replaced,
    };
    this.generations.push(record);
    return record;
  }

  snapshot(): FarmSnapshot {
    return {
      generation: this.generation,
      agents: this.agents,
      generations: this.generations,
      tasks: this.tasks.slice(-300).reverse(),
      hunts: this.hunts.slice(-200).reverse(),
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
