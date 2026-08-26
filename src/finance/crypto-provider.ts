/**
 * Crypto settlement provider boundary (the on-chain rail).
 *
 * The finance core NEVER signs or broadcasts transactions directly; it goes
 * through this interface. Default is a disabled sandbox (testnet assets
 * only, simulated transfer, no network). The live EVM provider is
 * constructed from server-side credentials and fails closed on any
 * misconfiguration. Private keys / RPC credentials never leave this module
 * and are never serialized.
 *
 * The interface is dynamic-import friendly: a real implementation can use
 * `ethers` server-side without adding it to frontend bundles.
 */

import { assertEvmAddress, requireAsset, type AssetKey, type CryptoAsset } from "./crypto";

export interface CryptoTransferRequest {
  settlementId: string;
  asset: AssetKey;
  /** Base units (wei), integer. */
  amountBase: bigint;
  /** EVM destination address, validated at the boundary. */
  toAddress: string;
  idempotencyKey: string;
}

export interface CryptoTransferResult {
  /** 0x-prefixed on-chain transaction hash. */
  txHash: string;
  status: "CONFIRMED";
}

/**
 * Implementations must be idempotent on idempotencyKey and throw on any
 * failure; the settlement engine performs a compensating release on throw.
 */
export interface CryptoSettlementProvider {
  readonly id: string;
  readonly mode: "sandbox" | "live";
  readonly chains: readonly string[];
  transfer(request: CryptoTransferRequest): Promise<CryptoTransferResult>;
}

export function validateTransferRequest(request: CryptoTransferRequest): CryptoAsset {
  const asset = requireAsset(request.asset);
  assertEvmAddress(request.toAddress);
  if (request.amountBase <= 0n) {
    throw new Error("Transfer amount must be positive base units");
  }
  return asset;
}

/**
 * Disabled paper-money rail: simulates a testnet transfer locally, derives a
 * deterministic pseudo tx hash, and refuses any mainnet (non-sandbox) asset.
 * No network, no keys, no real funds — safe default for development.
 */
export class DisabledSandboxCryptoProvider implements CryptoSettlementProvider {
  readonly id = "crypto-sandbox-disabled";
  readonly mode = "sandbox" as const;
  readonly chains = ["sepolia"] as const;
  private transfers = new Map<string, CryptoTransferResult>();
  private counter = 0;

  transfer(request: CryptoTransferRequest): Promise<CryptoTransferResult> {
    const asset = validateTransferRequest(request);
    if (!asset.sandbox) {
      return Promise.reject(
        new Error(`Sandbox rail refuses mainnet asset ${request.asset}; live settlement requires the live provider`),
      );
    }

    const existing = this.transfers.get(request.idempotencyKey);
    if (existing) return Promise.resolve(existing);

    const suffix = (this.counter++).toString(16).padStart(64, "0");
    const result: CryptoTransferResult = {
      txHash: `0xsandbox${suffix}`.slice(0, 66).padEnd(66, "0"),
      status: "CONFIRMED",
    };
    this.transfers.set(request.idempotencyKey, result);
    return Promise.resolve(result);
  }

  get transferCount(): number {
    return this.transfers.size;
  }
}

export interface LiveEvmCredentials {
  rpcUrl: string;
  /** Hex private key, server-side only. */
  privateKey: string;
}

/**
 * Live on-chain rail. Construction validates credentials (fail closed);
 * transfer() is intentionally not wired to a signer yet — integrating a real
 * signer (ethers/viem) happens here without touching Farm/Mesh/finance core.
 */
export class EvmCryptoProvider implements CryptoSettlementProvider {
  readonly id = "evm";
  readonly mode = "live" as const;
  readonly chains: readonly string[];

  constructor(private readonly credentials: LiveEvmCredentials, chains: string[]) {
    if (!credentials.rpcUrl.startsWith("https://") && !credentials.rpcUrl.startsWith("wss://")) {
      throw new Error("Live crypto provider requires an https:// or wss:// RPC endpoint");
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(credentials.privateKey)) {
      throw new Error("Live crypto provider requires a 0x-prefixed 32-byte private key");
    }
    this.chains = chains;
  }

  transfer(request: CryptoTransferRequest): Promise<CryptoTransferResult> {
    validateTransferRequest(request);
    return Promise.reject(
      new Error(
        "Live on-chain transfers are not enabled in this build; refusing to move funds. " +
          "Wire a signer into EvmCryptoProvider to enable.",
      ),
    );
  }
}
