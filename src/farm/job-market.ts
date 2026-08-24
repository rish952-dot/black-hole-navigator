import type { JobOpportunity } from "./job-pathways";
import type { ExternalWorkAdapter, ExternalWorkReceipt, ExternalWorkRequest } from "./external-work";
import type { RNG } from "./rng";
import type { TaskCategory } from "./types";

/**
 * Synthetic job board: the default work provider. Postings and payouts are
 * simulated — receipts are bookkeeping only, never real funds. A real
 * provider implements ExternalWorkAdapter and is plugged in through the
 * same submit() path after its own account/terms authorization.
 */

const TITLES: [string, TaskCategory, string[]][] = [
  ["Dataset classification sweep", "classification", ["llm", "search"]],
  ["Market research brief", "research", ["search", "browser"]],
  ["CRM data-cleaning batch", "data-cleaning", ["file-processing", "python"]],
  ["Quarterly metrics analysis", "analysis", ["data-analysis", "python"]],
  ["Webhook integration patch", "coding", ["code-exec", "api"]],
  ["Support ticket triage", "classification", ["llm", "api"]],
  ["Competitor pricing scrape review", "research", ["browser", "search"]],
  ["Ledger reconciliation pass", "data-cleaning", ["python", "data-analysis"]],
  ["A/B results deep-dive", "analysis", ["data-analysis", "llm"]],
  ["Test coverage uplift", "coding", ["code-exec", "python"]],
];

const ORGS = ["Helios Analytics", "Northwind Labs", "Vectorline", "Quantico Systems", "Fjordworks", "Lattice & Co"];

export class SyntheticJobBoard implements ExternalWorkAdapter {
  readonly id = "synthetic-job-board";
  readonly categories = ["classification", "research", "data-cleaning", "analysis", "coding"] as const;
  private seq = 0;

  constructor(private rng: RNG) {}

  discoverJobs(count: number): JobOpportunity[] {
    const jobs: JobOpportunity[] = [];
    for (let i = 0; i < count; i++) {
      const [title, category, skills] = TITLES[this.rng.int(0, TITLES.length - 1)];
      jobs.push({
        id: `job-${this.seq++}`,
        title,
        organization: ORGS[this.rng.int(0, ORGS.length - 1)],
        skills,
        location: this.rng.chance(0.6) ? "remote" : "on-site",
        remote: this.rng.chance(0.6),
        compensation: +(20 + this.rng.next() * 480).toFixed(2),
        url: `synthetic://${category}/${this.seq}`,
      });
    }
    return jobs;
  }

  submit(request: ExternalWorkRequest): Promise<ExternalWorkReceipt> {
    const { opportunity, agentId } = request;
    const skillBonus = Number(request.payload.matchScore ?? 0.5);
    const accepted = this.rng.chance(Math.min(0.95, opportunity.baseSuccessProb * (0.5 + skillBonus)));
    return Promise.resolve({
      providerTaskId: `${this.id}-${opportunity.id}-${agentId}`,
      accepted,
      revenue: accepted ? opportunity.payout : 0,
      currency: "SIM",
      completedAt: new Date().toISOString(),
      evidenceUrl: `synthetic://receipt/${opportunity.id}`,
    });
  }

  /** Synchronous settle for the engine's per-generation pipeline. */
  settle(request: ExternalWorkRequest): ExternalWorkReceipt {
    const { opportunity, agentId } = request;
    const skillBonus = Number(request.payload.matchScore ?? 0.5);
    const accepted = this.rng.chance(Math.min(0.95, opportunity.baseSuccessProb * (0.5 + skillBonus)));
    return {
      providerTaskId: `${this.id}-${opportunity.id}-${agentId}`,
      accepted,
      revenue: accepted ? opportunity.payout : 0,
      currency: "SIM",
      completedAt: new Date().toISOString(),
      evidenceUrl: `synthetic://receipt/${opportunity.id}`,
    };
  }
}
