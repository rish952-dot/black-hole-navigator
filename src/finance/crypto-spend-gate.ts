/**
 * Hard spending/execution limits for crypto outflows, enforced per asset.
 * Same fail-closed contract as `spend-gate.ts`: assert BEFORE any ledger
 * write or provider call; exceeding a limit throws and records nothing.
 */

import { LimitExceededError } from "./errors";
import type { AssetKey } from "./crypto";

export interface CryptoAssetLimits {
  /** Max single transaction, base units. */
  maxPerTransaction: bigint;
  /** Max spend per agent per day, base units. */
  maxPerAgentPerDay: bigint;
  /** Max total spend per day, base units. */
  maxTotalPerDay: bigint;
}

export type CryptoLimits = Partial<Record<AssetKey, CryptoAssetLimits>>;

const DAY_MS = 24 * 60 * 60 * 1000;

interface AssetUsage {
  spentTodayTotal: bigint;
  spentTodayByAgent: Map<string, bigint>;
  dayStart: number;
}

const zeroUsage = (): AssetUsage => ({
  spentTodayTotal: 0n,
  spentTodayByAgent: new Map(),
  dayStart: Date.now(),
});

export class CryptoSpendGate {
  private usage = new Map<AssetKey, AssetUsage>();

  constructor(private readonly limits: CryptoLimits) {}

  private usageFor(asset: AssetKey, now: number): AssetUsage {
    let usage = this.usage.get(asset);
    if (!usage) {
      usage = zeroUsage();
      this.usage.set(asset, usage);
    }
    if (now - usage.dayStart >= DAY_MS) {
      usage.dayStart = now;
      usage.spentTodayTotal = 0n;
      usage.spentTodayByAgent.clear();
    }
    return usage;
  }

  /** Throws LimitExceededError if the spend is not allowed. Amount in base units. */
  assertAllowed(asset: AssetKey, agentId: string | undefined, amountBase: bigint, now = Date.now()): void {
    if (amountBase <= 0n) return; // credits/releases are not spends

    const limits = this.limits[asset];
    if (!limits) {
      // Fail closed: no configured limits means no spending authority.
      throw new LimitExceededError(`No spending limits configured for ${asset}; refusing to move funds`);
    }
    if (limits.maxPerTransaction <= 0n || limits.maxPerAgentPerDay <= 0n || limits.maxTotalPerDay <= 0n) {
      throw new LimitExceededError(`Spending limits for ${asset} must be non-zero`);
    }

    const usage = this.usageFor(asset, now);
    if (amountBase > limits.maxPerTransaction) {
      throw new LimitExceededError("Amount exceeds the per-transaction crypto spending limit");
    }
    const agentSpent = agentId ? usage.spentTodayByAgent.get(agentId) ?? 0n : 0n;
    if (agentId && agentSpent + amountBase > limits.maxPerAgentPerDay) {
      throw new LimitExceededError("Amount exceeds the per-agent daily crypto spending limit");
    }
    if (usage.spentTodayTotal + amountBase > limits.maxTotalPerDay) {
      throw new LimitExceededError("Amount exceeds the total daily crypto spending limit");
    }
  }

  /** Record a spend that has already passed assertAllowed. */
  commit(asset: AssetKey, agentId: string | undefined, amountBase: bigint, now = Date.now()): void {
    if (amountBase <= 0n) return;
    const usage = this.usageFor(asset, now);
    usage.spentTodayTotal += amountBase;
    if (agentId) {
      usage.spentTodayByAgent.set(agentId, (usage.spentTodayByAgent.get(agentId) ?? 0n) + amountBase);
    }
  }

  /** Total spent today per asset, base units. */
  snapshot(): Partial<Record<AssetKey, bigint>> {
    const out: Partial<Record<AssetKey, bigint>> = {};
    for (const [asset, usage] of this.usage) {
      this.usageFor(asset, Date.now());
      out[asset] = usage.spentTodayTotal;
    }
    return out;
  }
}
