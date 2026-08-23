import type { Opportunity, TaskCategory } from "./types";

export interface ExternalWorkRequest {
  opportunity: Opportunity;
  agentId: string;
  payload: Record<string, unknown>;
}

export interface ExternalWorkReceipt {
  providerTaskId: string;
  accepted: boolean;
  revenue?: number;
  currency?: string;
  completedAt?: string;
  evidenceUrl?: string;
}

/**
 * Last-mile interface for an explicitly integrated work provider.
 * Implementations must be supplied separately after the provider's own
 * account/API authorization and terms review. The farm itself never stores
 * signing keys or wallet seed phrases.
 */
export interface ExternalWorkAdapter {
  readonly id: string;
  readonly categories: readonly TaskCategory[];
  submit(request: ExternalWorkRequest): Promise<ExternalWorkReceipt>;
}

export function validateReceipt(receipt: ExternalWorkReceipt): boolean {
  return receipt.accepted &&
    typeof receipt.providerTaskId === "string" &&
    (receipt.revenue === undefined || Number.isFinite(receipt.revenue));
}
