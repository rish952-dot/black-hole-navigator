export type PaymentAsset = "USDC" | "USDT" | "ETH";

export interface AgentEarnings {
  agentId: string;
  botId: number;
  grossRevenue: number;
  computeCost: number;
  otherCost: number;
  netProfit: number;
  roi: number;
  tasksCompleted: number;
  updatedAt: string;
}

export interface PaymentWallet {
  chain: "ethereum";
  address: string;
  asset: PaymentAsset;
  mode: "ledger_only" | "approval_required";
}

export interface PaymentProposal {
  id: string;
  recipient: string;
  asset: PaymentAsset;
  amount: string;
  sourceAgent: string;
  sourceProfit: number;
  status: "PROPOSED" | "APPROVED" | "REJECTED";
  createdAt: string;
}

const EVM = /^0x[a-fA-F0-9]{40}$/;

export function validWallet(address: string): boolean {
  return EVM.test(address.trim());
}

export function rankEarnings(rows: AgentEarnings[]): AgentEarnings[] {
  return [...rows].sort((a, b) => b.netProfit - a.netProfit || b.roi - a.roi);
}

export function makePaymentProposal(input: {
  wallet: PaymentWallet;
  agent: AgentEarnings;
  share?: number;
}): PaymentProposal {
  if (!validWallet(input.wallet.address)) throw new Error("Invalid EVM wallet");
  const share = Math.max(0, Math.min(1, input.share ?? 0.5));
  const amount = Math.max(0, input.agent.netProfit * share);
  return {
    id: `pay_${Date.now()}_${input.agent.agentId}`,
    recipient: input.wallet.address,
    asset: input.wallet.asset,
    amount: amount.toFixed(6),
    sourceAgent: input.agent.agentId,
    sourceProfit: input.agent.netProfit,
    status: "PROPOSED",
    createdAt: new Date().toISOString(),
  };
}

/**
 * This module is intentionally a ledger/proposal layer. It does not sign,
 * broadcast, or custody blockchain transactions.
 */
export interface PaymentExecutor {
  executeApproved(proposal: PaymentProposal): Promise<{ txHash: string }>;
}
