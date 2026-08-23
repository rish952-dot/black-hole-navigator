export type SettlementAsset = "ETH" | "USDC" | "USDT";

export interface SettlementProposal {
  id: string;
  createdAt: string;
  botId: number;
  recipient: string;
  asset: SettlementAsset;
  amount: string;
  reason: string;
  sourceNetProfit: number;
  status: "PROPOSED" | "APPROVED" | "REJECTED" | "PAID";
  approvalRequired: true;
}

const EVM = /^0x[a-fA-F0-9]{40}$/;

export function validateRecipient(address: string): boolean {
  return EVM.test(address.trim());
}

export function makeProposal(input: Omit<SettlementProposal, "id" | "createdAt" | "status" | "approvalRequired">): SettlementProposal {
  if (!validateRecipient(input.recipient)) throw new Error("Invalid EVM recipient");
  if (Number(input.amount) <= 0) throw new Error("Settlement amount must be positive");
  return {
    ...input,
    id: `settle_${Date.now()}_${input.botId}`,
    createdAt: new Date().toISOString(),
    status: "PROPOSED",
    approvalRequired: true,
  };
}

/**
 * Execution boundary: the farm may create proposals, but signing and broadcasting
 * a blockchain transaction must happen in a separately approved transaction system.
 */
export interface SettlementExecutor {
  executeApproved(proposal: SettlementProposal): Promise<{ txHash: string }>;
}

export function assertApproved(proposal: SettlementProposal): void {
  if (proposal.status !== "APPROVED") throw new Error("Settlement is not approved");
}
