import type { Opportunity, TaskCategory } from "./types";
import type { OpportunitySource } from "./marketplace";
import { RNG } from "./rng";

const CATEGORIES = new Set<TaskCategory>([
  "classification",
  "research",
  "data-cleaning",
  "analysis",
  "coding",
]);

export interface ExternalOpportunity {
  id: string;
  category: TaskCategory;
  payout: number;
  difficulty: number;
  durationMin: number;
  computeCost: number;
  baseSuccessProb: number;
  requiredTools: string[];
  competition: number;
  sourceUrl?: string;
}

function finite(n: unknown, fallback = 0): number {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function normalize(raw: unknown): Opportunity | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !CATEGORIES.has(r.category as TaskCategory)) return null;
  const payout = finite(r.payout);
  const difficulty = Math.max(0, Math.min(1, finite(r.difficulty, 0.5)));
  const durationMin = Math.max(1, Math.round(finite(r.durationMin, 10)));
  const computeCost = Math.max(0, finite(r.computeCost));
  const baseSuccessProb = Math.max(0, Math.min(1, finite(r.baseSuccessProb, 0.5)));
  const requiredTools = Array.isArray(r.requiredTools)
    ? r.requiredTools.filter((x): x is string => typeof x === "string").slice(0, 16)
    : [];
  const competition = Math.max(0, Math.min(1, finite(r.competition, 0)));
  if (!(payout > 0) || !Number.isFinite(difficulty) || !Number.isFinite(baseSuccessProb)) return null;
  return {
    id: r.id,
    category: r.category as TaskCategory,
    payout: +payout.toFixed(2),
    difficulty: +difficulty.toFixed(3),
    durationMin,
    computeCost: +computeCost.toFixed(2),
    baseSuccessProb: +baseSuccessProb.toFixed(3),
    requiredTools,
    competition: +competition.toFixed(2),
  };
}

export class HttpOpportunityGateway implements OpportunitySource {
  id = "http-external-readonly";

  constructor(
    private readonly url: string,
    private readonly bearerToken?: string,
    private readonly timeoutMs = 8000,
  ) {}

  discoverTasks(count: number, _rng: RNG): Opportunity[] {
    throw new Error(`HttpOpportunityGateway is async-only; call discoverAsync(${count})`);
  }

  async discoverAsync(count: number): Promise<Opportunity[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (this.bearerToken) headers.Authorization = `Bearer ${this.bearerToken}`;
      const response = await fetch(this.url, { headers, signal: controller.signal });
      if (!response.ok) throw new Error(`Opportunity feed HTTP ${response.status}`);
      const body = await response.json() as unknown;
      const rows = Array.isArray(body) ? body : (body as { opportunities?: unknown[] })?.opportunities;
      if (!Array.isArray(rows)) return [];
      return rows.map(normalize).filter((x): x is Opportunity => x !== null).slice(0, Math.max(1, count));
    } finally {
      clearTimeout(timer);
    }
  }
}

export function buildOpportunityGatewayFromEnv(): HttpOpportunityGateway | null {
  const url = process.env.OPPORTUNITY_FEED_URL?.trim();
  if (!url) return null;
  const token = process.env.OPPORTUNITY_FEED_TOKEN?.trim();
  return new HttpOpportunityGateway(url, token);
}
