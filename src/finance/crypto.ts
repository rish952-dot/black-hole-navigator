/**
 * Cryptocurrency asset registry for the finance subsystem.
 *
 * The subsystem deals ONLY in registered crypto assets — no fiat, no
 * arbitrary asset strings. Amounts are always integer base units (wei /
 * 10^-decimals) as bigint; decimals are validated per asset at the boundary.
 *
 * Fail-closed: unknown assets, malformed addresses, and mismatched decimals
 * throw CryptoAssetError before any ledger write can happen.
 */

export class CryptoAssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CryptoAssetError";
  }
}

export type ChainId = "ethereum" | "sepolia" | "polygon" | "arbitrum" | "base";

export interface CryptoAsset {
  symbol: string;
  chain: ChainId;
  decimals: number;
  /** ERC-20 contract address; null for the chain's native asset (ETH). */
  contractAddress: string | null;
  /** True for testnet assets usable in sandbox mode. */
  sandbox: boolean;
}

export const CRYPTO_ASSETS: Readonly<Record<string, CryptoAsset>> = {
  "ETH.sepolia": { symbol: "ETH", chain: "sepolia", decimals: 18, contractAddress: null, sandbox: true },
  "USDC.sepolia": {
    symbol: "USDC",
    chain: "sepolia",
    decimals: 6,
    contractAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    sandbox: true,
  },
  "ETH.ethereum": { symbol: "ETH", chain: "ethereum", decimals: 18, contractAddress: null, sandbox: false },
  "USDC.ethereum": {
    symbol: "USDC",
    chain: "ethereum",
    decimals: 6,
    contractAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    sandbox: false,
  },
  "USDC.base": {
    symbol: "USDC",
    chain: "base",
    decimals: 6,
    contractAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    sandbox: false,
  },
};

export type AssetKey = keyof typeof CRYPTO_ASSETS;

export function isAssetKey(value: string): value is AssetKey {
  return Object.prototype.hasOwnProperty.call(CRYPTO_ASSETS, value);
}

/** Resolve an asset key or throw. This is the only way to get a CryptoAsset. */
export function requireAsset(key: string): CryptoAsset {
  const asset = CRYPTO_ASSETS[key];
  if (!asset) throw new CryptoAssetError(`Unknown crypto asset "${key}". Registered: ${Object.keys(CRYPTO_ASSETS).join(", ")}`);
  return asset;
}

const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/** Validate an EVM destination address (checksummed or not). */
export function assertEvmAddress(address: string): string {
  const trimmed = address.trim();
  if (!EVM_ADDRESS_PATTERN.test(trimmed)) {
    throw new CryptoAssetError("Invalid EVM address: expected 0x followed by 40 hex characters");
  }
  return trimmed;
}

/**
 * Parse a decimal string into bigint base units for the given asset.
 * Accepts "1.5", "0.000001", "2" — never floats, never scientific notation.
 */
export function parseUnits(amount: string, asset: CryptoAsset): bigint {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new CryptoAssetError(`Invalid amount "${amount}": expected a non-negative decimal string`);
  }
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > asset.decimals) {
    throw new CryptoAssetError(`Amount "${amount}" exceeds ${asset.decimals} decimals for ${asset.symbol} on ${asset.chain}`);
  }
  const padded = fraction.padEnd(asset.decimals, "0");
  return BigInt(whole) * 10n ** BigInt(asset.decimals) + (padded ? BigInt(padded) : 0n);
}

/** Format bigint base units as a trimmed decimal string for display/telemetry. */
export function formatUnits(baseUnits: bigint, asset: CryptoAsset): string {
  const negative = baseUnits < 0n;
  const abs = negative ? -baseUnits : baseUnits;
  const scale = 10n ** BigInt(asset.decimals);
  const whole = abs / scale;
  const fraction = (abs % scale).toString().padStart(asset.decimals, "0").replace(/0+$/, "");
  const rendered = fraction ? `${whole}.${fraction}` : whole.toString();
  return negative ? `-${rendered}` : rendered;
}
