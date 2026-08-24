/**
 * Hard spending/execution limits. Every outbound economic action must pass
 * this gate BEFORE any ledger entry is written or provider call is made.
 * The gate fails closed: it throws and records nothing when a limit would be
 * exceeded.
 */

import { LimitExceededError } from "./errors";
import type { FinanceLimits } from "./config";

const DAY_MS = 24 * 60 * 60 * 1000;

export class SpendGate {
  private spentTodayTotal = 0;
  private spentTodayByAgent = new Map<string, number>();
  private dayStart = Date.now();

  constructor(private readonly limits: FinanceLimits) {}

  private rollDay(now: number): void {
    if (now - this.dayStart >= DAY_MS) {
      this.dayStart = now;
      this.spentTodayTotal = 0;
      this.spentTodayByAgent.clear();
    }
  }

  /** Throws LimitExceededError if the spend is not allowed. Amount in minor units. */
  assertAllowed(agentId: string | undefined, amountMinor: number, now = Date.now()): void {
    this.rollDay(now);
    if (amountMinor <= 0) return; // credits/releases are not spends

    if (amountMinor > this.limits.maxPerTransaction) {
      throw new LimitExceededError("Amount exceeds the per-transaction spending limit");
    }

    const agentSpent = agentId ? this.spentTodayByAgent.get(agentId) ?? 0 : 0;
    if (agentId && agentSpent + amountMinor > this.limits.maxPerAgentPerDay) {
      throw new LimitExceededError("Amount exceeds the per-agent daily spending limit");
    }
    if (this.spentTodayTotal + amountMinor > this.limits.maxTotalPerDay) {
      throw new LimitExceededError("Amount exceeds the total daily spending limit");
    }
  }

  /** Record a spend that has already passed assertAllowed. */
  commit(agentId: string | undefined, amountMinor: number, now = Date.now()): void {
    this.rollDay(now);
    if (amountMinor <= 0) return;
    this.spentTodayTotal += amountMinor;
    if (agentId) {
      this.spentTodayByAgent.set(agentId, (this.spentTodayByAgent.get(agentId) ?? 0) + amountMinor);
    }
  }

  snapshot(): { spentTodayTotal: number; spentTodayByAgent: Record<string, number> } {
    this.rollDay(Date.now());
    return {
      spentTodayTotal: this.spentTodayTotal,
      spentTodayByAgent: Object.fromEntries(this.spentTodayByAgent),
    };
  }
}
