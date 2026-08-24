/**
 * Feature flags + configuration for the finance subsystem.
 *
 * Fail-closed rules (evaluated in this order):
 *  1. Unless FINANCE_ENABLED=true, the subsystem refuses every operation.
 *  2. Default mode is "sandbox" (paper money only, in-memory provider).
 *  3. "live" mode additionally requires FINANCE_LIVE_ENABLED=true, configured
 *     provider credentials, and at least one non-zero spending limit.
 *
 * This module runs in Node AND browser contexts. It only reads process.env
 * directly in Node; browser callers must pass an explicit env snapshot so
 * secrets are never bundled into frontend code.
 */

import { FinanceConfigError } from "./errors";
import { toMinorUnits } from "./money";

export type FinanceMode = "sandbox" | "live";

export interface FinanceLimits {
  /** Max single transaction, minor units. */
  maxPerTransaction: number;
  /** Max spend per agent per day, minor units. */
  maxPerAgentPerDay: number;
  /** Max total spend per day, minor units. */
  maxTotalPerDay: number;
}

export interface FinanceConfig {
  enabled: boolean;
  mode: FinanceMode;
  liveEnabled: boolean;
  limits: FinanceLimits;
  /** Present only server-side; never serialize into telemetry or UI payloads. */
  providerCredentials: Record<string, string> | null;
}

export const DEFAULT_FINANCE_LIMITS: FinanceLimits = {
  maxPerTransaction: toMinorUnits(100),
  maxPerAgentPerDay: toMinorUnits(500),
  maxTotalPerDay: toMinorUnits(2_500),
};

type EnvSnapshot = Record<string, string | undefined>;

const envBool = (env: EnvSnapshot, key: string): boolean =>
  (env[key] ?? "false").toLowerCase() === "true";

const envMinorUnits = (env: EnvSnapshot, key: string, fallback: number): number => {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? toMinorUnits(parsed) : fallback;
};

/** Read an env snapshot safely; returns {} outside Node. */
function nodeEnv(): EnvSnapshot {
  return typeof process !== "undefined" && process.env ? process.env : {};
}

/**
 * Resolve configuration from the environment. In live mode any missing
 * credential or unsafe limit is a hard configuration error (fail closed).
 */
export function resolveFinanceConfig(env: EnvSnapshot = nodeEnv()): FinanceConfig {
  const enabled = envBool(env, "FINANCE_ENABLED");
  const liveEnabled = envBool(env, "FINANCE_LIVE_ENABLED");
  const mode: FinanceMode = env.FINANCE_MODE === "live" ? "live" : "sandbox";

  const limits: FinanceLimits = {
    maxPerTransaction: envMinorUnits(env, "FINANCE_MAX_PER_TX", DEFAULT_FINANCE_LIMITS.maxPerTransaction),
    maxPerAgentPerDay: envMinorUnits(env, "FINANCE_MAX_AGENT_DAILY", DEFAULT_FINANCE_LIMITS.maxPerAgentPerDay),
    maxTotalPerDay: envMinorUnits(env, "FINANCE_MAX_TOTAL_DAILY", DEFAULT_FINANCE_LIMITS.maxTotalPerDay),
  };

  const providerApiKey = (env.FINANCE_PROVIDER_API_KEY ?? "").trim();
  const providerCredentials = providerApiKey ? { apiKey: providerApiKey } : null;

  const config: FinanceConfig = { enabled, mode, liveEnabled, limits, providerCredentials };

  if (enabled && mode === "live") {
    if (!liveEnabled) {
      throw new FinanceConfigError("FINANCE_MODE=live requires FINANCE_LIVE_ENABLED=true");
    }
    if (!providerCredentials) {
      throw new FinanceConfigError("Live finance mode requires FINANCE_PROVIDER_API_KEY");
    }
    if (limits.maxPerTransaction <= 0 || limits.maxPerAgentPerDay <= 0 || limits.maxTotalPerDay <= 0) {
      throw new FinanceConfigError("Live finance mode requires non-zero spending limits");
    }
  }

  return config;
}

/** Redacted copy of the config that is safe to hand to telemetry/UI layers. */
export function publicFinanceConfig(config: FinanceConfig): Omit<FinanceConfig, "providerCredentials"> & { providerConfigured: boolean } {
  return {
    enabled: config.enabled,
    mode: config.mode,
    liveEnabled: config.liveEnabled,
    limits: { ...config.limits },
    providerConfigured: config.providerCredentials !== null,
  };
}
