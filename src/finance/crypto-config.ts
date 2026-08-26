/**
 * Configuration for the crypto settlement rail. Fail-closed rules:
 *  1. Unless FINANCE_ENABLED=true, the crypto rail refuses every operation.
 *  2. Default is sandbox (testnet assets only, no network).
 *  3. CRYPTO_MODE=live additionally requires CRYPTO_LIVE_ENABLED=true, an
 *     https/wss RPC URL, a 0x-prefixed private key, and non-zero limits for
 *     every enabled asset.
 *
 * Node-only: this module reads process.env; secrets must never be passed
 * into browser bundles (the service exposes a redacted public view).
 */

import { CryptoAssetError } from "./crypto";
import { parseUnits, requireAsset, CRYPTO_ASSETS, type AssetKey } from "./crypto";
import type { CryptoAssetLimits, CryptoLimits } from "./crypto-spend-gate";
import { FinanceConfigError } from "./errors";

export type CryptoMode = "sandbox" | "live";

export interface CryptoConfig {
  enabled: boolean;
  mode: CryptoMode;
  liveEnabled: boolean;
  /** Assets the rail will move at all; sandbox forces the sandbox assets. */
  enabledAssets: AssetKey[];
  limits: CryptoLimits;
  /** Server-side only; never serialize into telemetry or UI payloads. */
  credentials: { rpcUrl: string; privateKey: string } | null;
}

export interface CryptoPublicConfig {
  enabled: boolean;
  mode: CryptoMode;
  liveEnabled: boolean;
  enabledAssets: AssetKey[];
  limitsConfiguredFor: AssetKey[];
  credentialsConfigured: boolean;
}

type EnvSnapshot = Record<string, string | undefined>;

const envBool = (env: EnvSnapshot, key: string): boolean =>
  (env[key] ?? "false").toLowerCase() === "true";

function nodeEnv(): EnvSnapshot {
  return typeof process !== "undefined" && process.env ? process.env : {};
}

/** Default conservative limits: 0.05 ETH / 100 USDC per tx, 0.2 ETH / 500 USDC per agent-day, 0.5 ETH / 1000 USDC total-day. */
function defaultLimitsFor(asset: AssetKey): CryptoAssetLimits {
  const meta = CRYPTO_ASSETS[asset];
  if (meta.symbol === "ETH") {
    return {
      maxPerTransaction: parseUnits("0.05", meta),
      maxPerAgentPerDay: parseUnits("0.2", meta),
      maxTotalPerDay: parseUnits("0.5", meta),
    };
  }
  return {
    maxPerTransaction: parseUnits("100", meta),
    maxPerAgentPerDay: parseUnits("500", meta),
    maxTotalPerDay: parseUnits("1000", meta),
  };
}

export function resolveCryptoConfig(env: EnvSnapshot = nodeEnv()): CryptoConfig {
  const enabled = envBool(env, "FINANCE_ENABLED");
  const mode: CryptoMode = env.CRYPTO_MODE === "live" ? "live" : "sandbox";
  const liveEnabled = envBool(env, "CRYPTO_LIVE_ENABLED");

  let enabledAssets: AssetKey[];
  const rawAssets = (env.CRYPTO_ASSETS ?? "").trim();
  if (rawAssets) {
    enabledAssets = rawAssets.split(",").map((token) => {
      const key = token.trim();
      requireAsset(key); // throws on unknown asset (fail closed)
      return key as AssetKey;
    });
  } else {
    enabledAssets = mode === "live" ? ["ETH.ethereum", "USDC.ethereum"] : ["ETH.sepolia", "USDC.sepolia"];
  }
  if (mode === "sandbox") {
    for (const key of enabledAssets) {
      if (!CRYPTO_ASSETS[key].sandbox) {
        throw new CryptoAssetError(`Sandbox crypto rail cannot enable mainnet asset ${key}`);
      }
    }
  }

  const limits: CryptoLimits = {};
  for (const asset of enabledAssets) {
    const defaults = defaultLimitsFor(asset);
    const prefix = `CRYPTO_LIMIT_${asset.replace(/[^A-Za-z]/g, "_").toUpperCase()}`;
    const meta = CRYPTO_ASSETS[asset];
    const parseLimit = (suffix: string, fallback: bigint): bigint => {
      const raw = env[`${prefix}_${suffix}`];
      return raw === undefined || raw === "" ? fallback : parseUnits(raw, meta);
    };
    limits[asset] = {
      maxPerTransaction: parseLimit("PER_TX", defaults.maxPerTransaction),
      maxPerAgentPerDay: parseLimit("AGENT_DAILY", defaults.maxPerAgentPerDay),
      maxTotalPerDay: parseLimit("TOTAL_DAILY", defaults.maxTotalPerDay),
    };
  }

  const rpcUrl = (env.CRYPTO_RPC_URL ?? "").trim();
  const privateKey = (env.CRYPTO_PRIVATE_KEY ?? "").trim();
  const credentials = rpcUrl && privateKey ? { rpcUrl, privateKey } : null;

  const config: CryptoConfig = { enabled, mode, liveEnabled, enabledAssets, limits, credentials };

  if (enabled && mode === "live") {
    if (!liveEnabled) {
      throw new FinanceConfigError("CRYPTO_MODE=live requires CRYPTO_LIVE_ENABLED=true");
    }
    if (!credentials) {
      throw new FinanceConfigError("Live crypto mode requires CRYPTO_RPC_URL and CRYPTO_PRIVATE_KEY");
    }
    for (const asset of enabledAssets) {
      const assetLimits = limits[asset];
      if (!assetLimits || assetLimits.maxPerTransaction <= 0n || assetLimits.maxPerAgentPerDay <= 0n || assetLimits.maxTotalPerDay <= 0n) {
        throw new FinanceConfigError(`Live crypto mode requires non-zero spending limits for ${asset}`);
      }
    }
  }

  return config;
}

/** Redacted view of the config that is safe for telemetry/UI layers. */
export function publicCryptoConfig(config: CryptoConfig): CryptoPublicConfig {
  return {
    enabled: config.enabled,
    mode: config.mode,
    liveEnabled: config.liveEnabled,
    enabledAssets: [...config.enabledAssets],
    limitsConfiguredFor: Object.keys(config.limits) as AssetKey[],
    credentialsConfigured: config.credentials !== null,
  };
}
