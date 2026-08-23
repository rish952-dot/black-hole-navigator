export type JobStage = "discover" | "eligibility" | "match" | "apply" | "follow-up" | "skill-gap" | "upskill" | "outcome";

export type JobOpportunity = {
  id: string;
  title: string;
  organization?: string;
  skills: string[];
  location?: string;
  remote?: boolean;
  compensation?: number;
  url?: string;
};

export type AgentProfile = {
  agentId: string;
  skills: string[];
  preferredLocations?: string[];
  remotePreferred?: boolean;
  minimumCompensation?: number;
};

export type JobPath = {
  opportunityId: string;
  stage: JobStage;
  score: number;
  missingSkills: string[];
  nextAction: string;
};

export function buildJobPath(profile: AgentProfile, opportunity: JobOpportunity): JobPath {
  const skills = new Set(profile.skills.map((s) => s.toLowerCase()));
  const missingSkills = opportunity.skills.filter((s) => !skills.has(s.toLowerCase()));
  const skillScore = opportunity.skills.length ? 1 - missingSkills.length / opportunity.skills.length : 0;
  const locationScore = !profile.preferredLocations?.length || !opportunity.location || profile.preferredLocations.includes(opportunity.location) ? 1 : 0.5;
  const remoteScore = profile.remotePreferred && opportunity.remote ? 1 : 0.7;
  const compensationScore = profile.minimumCompensation && opportunity.compensation
    ? Math.min(1, opportunity.compensation / profile.minimumCompensation)
    : 0.7;
  const score = +(skillScore * 0.5 + locationScore * 0.15 + remoteScore * 0.15 + compensationScore * 0.2).toFixed(4);

  if (missingSkills.length) return { opportunityId: opportunity.id, stage: "skill-gap", score, missingSkills, nextAction: `Upskill in: ${missingSkills.join(", ")}` };
  return { opportunityId: opportunity.id, stage: "apply", score, missingSkills: [], nextAction: "Prepare application and submit through the approved application adapter" };
}

export function rankJobPaths(profile: AgentProfile, opportunities: JobOpportunity[]): JobPath[] {
  return opportunities.map((job) => buildJobPath(profile, job)).sort((a, b) => b.score - a.score);
}
