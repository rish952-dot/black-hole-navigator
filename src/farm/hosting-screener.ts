import type { AgentEarnings, PaymentWallet, PaymentProposal } from "./payment-ledger";
import { makePaymentProposal, rankEarnings } from "./payment-ledger";

export type HostingTier = "nano" | "standard" | "pro" | "elite";

export interface HostingProfile {
  tier: HostingTier;
  cpu: number;
  ramGb: number;
  concurrency: number;
  opportunitiesPerRound: number;
  vectorBusCapacity: number;
}

export interface AgentHostingAllocation {
  agentId: string;
  botId: number;
  netProfit: number;
  rank: number;
  tier: HostingTier;
  profile: HostingProfile;
  payoutProposal?: PaymentProposal;
}

const PROFILES: Record<HostingTier, HostingProfile> = {
  nano: { tier: "nano", cpu: 1, ramGb: 1, concurrency: 1, opportunitiesPerRound: 100, vectorBusCapacity: 100 },
  standard: { tier: "standard", cpu: 2, ramGb: 4, concurrency: 2, opportunitiesPerRound: 300, vectorBusCapacity: 500 },
  pro: { tier: "pro", cpu: 4, ramGb: 8, concurrency: 4, opportunitiesPerRound: 700, vectorBusCapacity: 1200 },
  elite: { tier: "elite", cpu: 8, ramGb: 16, concurrency: 8, opportunitiesPerRound: 1200, vectorBusCapacity: 2500 },
};

export function hostingTier(profit: number, rank: number, total: number): HostingTier {
  if (profit >= 500 || rank <= Math.max(1, Math.ceil(total * 0.1))) return "elite";
  if (profit >= 200 || rank <= Math.max(1, Math.ceil(total * 0.25))) return "pro";
  if (profit >= 50 || rank <= Math.max(1, Math.ceil(total * 0.6))) return "standard";
  return "nano";
}

export function screenAndAllocate(
  earnings: AgentEarnings[],
  wallet?: PaymentWallet,
  payoutShare = 0.5,
): AgentHostingAllocation[] {
  const ranked = rankEarnings(earnings);
  return ranked.map((agent, index) => {
    const tier = hostingTier(agent.netProfit, index + 1, ranked.length);
    const payoutProposal = wallet && agent.netProfit > 0
      ? makePaymentProposal({ wallet, agent, share: payoutShare })
      : undefined;
    return {
      agentId: agent.agentId,
      botId: agent.botId,
      netProfit: agent.netProfit,
      rank: index + 1,
      tier,
      profile: PROFILES[tier],
      ...(payoutProposal ? { payoutProposal } : {}),
    };
  });
}
