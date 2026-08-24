import { describe, expect, it } from "vitest";
import { CryptoFinanceService } from "@/finance/crypto-service";
import { resolveCryptoConfig, type CryptoConfig } from "@/finance/crypto-config";
import { parseUnits, requireAsset, formatUnits, CryptoAssetError, assertEvmAddress } from "@/finance/crypto";
import { CryptoLedger } from "@/finance/crypto-ledger";
import { reconcileCrypto, detectCryptoAnomalies } from "@/finance/crypto-reconciliation";
import { DisabledSandboxCryptoProvider, type CryptoSettlementProvider } from "@/finance/crypto-provider";
import { Principals } from "@/finance/auth";
import {
  FinanceConfigError,
  FinanceDisabledError,
  LedgerInvariantError,
  LimitExceededError,
  SettlementStateError,
  UnauthorizedFinanceOperationError,
} from "@/finance/errors";

const ETH = "ETH.sepolia";
const USDC = "USDC.sepolia";
const WALLET_A = "0x1111111111111111111111111111111111111111";
const WALLET_B = "0x2222222222222222222222222222222222222222";

const sandboxConfig = (overrides: Partial<CryptoConfig> = {}): CryptoConfig => ({
  enabled: true,
  mode: "sandbox",
  liveEnabled: false,
  enabledAssets: [ETH, USDC],
  limits: {
    [ETH]: {
      maxPerTransaction: parseUnits("0.05", requireAsset(ETH)),
      maxPerAgentPerDay: parseUnits("0.2", requireAsset(ETH)),
      maxTotalPerDay: parseUnits("0.5", requireAsset(ETH)),
    },
    [USDC]: {
      maxPerTransaction: parseUnits("100", requireAsset(USDC)),
      maxPerAgentPerDay: parseUnits("500", requireAsset(USDC)),
      maxTotalPerDay: parseUnits("1000", requireAsset(USDC)),
    },
  },
  credentials: null,
  ...overrides,
});

const system = Principals.system();
const operator = Principals.operator("admin-1");
const agent = Principals.agent("agent-7");
const viewer = Principals.viewer("mesh-ui");
const anonymous = Principals.anonymous();

describe("crypto asset primitives", () => {
  it("parses and formats base units per asset decimals", () => {
    expect(parseUnits("1.5", requireAsset(ETH))).toBe(1_500_000_000_000_000_000n);
    expect(parseUnits("0.000001", requireAsset(USDC))).toBe(1n);
    expect(formatUnits(1_500_000_000_000_000_000n, requireAsset(ETH))).toBe("1.5");
    expect(formatUnits(-2_500_000n, requireAsset(USDC))).toBe("-2.5");
  });

  it("rejects over-precision, unknown assets, and bad addresses", () => {
    expect(() => parseUnits("0.0000001", requireAsset(USDC))).toThrow(CryptoAssetError);
    expect(() => parseUnits("abc", requireAsset(ETH))).toThrow(CryptoAssetError);
    expect(() => requireAsset("DOGE.ethereum")).toThrow(/unknown crypto asset/i);
    expect(() => assertEvmAddress("0x1234")).toThrow(/invalid evm address/i);
    expect(assertEvmAddress(WALLET_A)).toBe(WALLET_A);
  });
});

describe("crypto ledger invariants", () => {
  it("commits balanced entries, tracks per-asset balances, and verifies the hash chain", () => {
    const ledger = new CryptoLedger();
    ledger.post({
      kind: "crypto_revenue",
      asset: ETH,
      lines: [
        { account: "crypto:custody", amount: parseUnits("1", requireAsset(ETH)) },
        { account: "crypto:revenue:task-payouts", amount: -parseUnits("1", requireAsset(ETH)) },
      ],
      provenance: { agentId: "agent-1" },
    });
    ledger.post({
      kind: "crypto_revenue",
      asset: USDC,
      lines: [
        { account: "crypto:custody", amount: parseUnits("20", requireAsset(USDC)) },
        { account: "crypto:revenue:task-payouts", amount: -parseUnits("20", requireAsset(USDC)) },
      ],
    });

    expect(ledger.size).toBe(2);
    // Per-asset balances stay separate.
    expect(ledger.balanceOfAsset(ETH, "crypto:custody")).toBe(parseUnits("1", requireAsset(ETH)));
    expect(ledger.balanceOfAsset(USDC, "crypto:custody")).toBe(parseUnits("20", requireAsset(USDC)));
    expect(ledger.verifyIntegrity()).toEqual([]);
  });

  it("rejects unbalanced, zero-amount, and unknown-account entries without writing", () => {
    const ledger = new CryptoLedger();
    expect(() =>
      ledger.post({
        kind: "crypto_revenue",
        asset: ETH,
        lines: [
          { account: "crypto:custody", amount: 100n },
          { account: "crypto:revenue:task-payouts", amount: -99n },
        ],
      }),
    ).toThrow(LedgerInvariantError);
    expect(() =>
      ledger.post({
        kind: "crypto_revenue",
        asset: ETH,
        lines: [
          { account: "crypto:custody", amount: 0n },
          { account: "crypto:revenue:task-payouts", amount: -100n },
        ],
      }),
    ).toThrow(/non-zero/);
    expect(() =>
      ledger.post({
        kind: "crypto_revenue",
        asset: ETH,
        lines: [
          { account: "cash:operating" as never, amount: 100n },
          { account: "crypto:revenue:task-payouts", amount: -100n },
        ],
      }),
    ).toThrow(/unknown crypto account/i);
    expect(ledger.size).toBe(0);
  });

  it("applies idempotency keys exactly once", () => {
    const ledger = new CryptoLedger();
    const first = ledger.post({
      kind: "crypto_reward",
      asset: USDC,
      lines: [
        { account: "crypto:custody", amount: 5_000_000n },
        { account: "crypto:revenue:rewards", amount: -5_000_000n },
      ],
      idempotencyKey: "key-1",
    });
    const second = ledger.post({
      kind: "crypto_reward",
      asset: USDC,
      lines: [
        { account: "crypto:custody", amount: 5_000_000n },
        { account: "crypto:revenue:rewards", amount: -5_000_000n },
      ],
      idempotencyKey: "key-1",
    });
    expect(second.id).toBe(first.id);
    expect(ledger.size).toBe(1);
  });

  it("detects tampering through the hash chain", () => {
    const ledger = new CryptoLedger();
    ledger.post({
      kind: "crypto_capital",
      asset: ETH,
      lines: [
        { account: "crypto:custody", amount: 10n },
        { account: "crypto:equity:owner-capital", amount: -10n },
      ],
    });
    const internal = ledger as unknown as { entries: Array<{ lines: Array<{ amount: bigint }> }> };
    internal.entries[0].lines[0].amount = 999n;
    expect(ledger.verifyIntegrity().length).toBeGreaterThan(0);
  });

  it("satisfies the accounting equation per asset", () => {
    const ledger = new CryptoLedger();
    ledger.post({
      kind: "crypto_capital",
      asset: ETH,
      lines: [
        { account: "crypto:custody", amount: parseUnits("2", requireAsset(ETH)) },
        { account: "crypto:equity:owner-capital", amount: -parseUnits("2", requireAsset(ETH)) },
      ],
    });
    ledger.post({
      kind: "crypto_cost",
      asset: ETH,
      lines: [
        { account: "crypto:expense:compute", amount: parseUnits("0.1", requireAsset(ETH)) },
        { account: "crypto:custody", amount: -parseUnits("0.1", requireAsset(ETH)) },
      ],
    });
    const report = reconcileCrypto(ledger);
    expect(report.ok).toBe(true);
    expect(report.perAsset.find((r) => r.asset === ETH)?.accountingEquationBalanced).toBe(true);
  });

  it("flags payouts without an on-chain tx hash", () => {
    const ledger = new CryptoLedger();
    ledger.post({
      kind: "crypto_settlement_payout",
      asset: ETH,
      lines: [
        { account: "crypto:payable:settlements", amount: 10n },
        { account: "crypto:custody", amount: -10n },
      ],
      provenance: { settlementId: "s-1" },
    });
    const anomalies = detectCryptoAnomalies(ledger);
    expect(anomalies.some((a) => a.code === "UNCONFIRMED_ONCHAIN_PAYOUT" && a.severity === "critical")).toBe(true);
  });
});

describe("feature flag & fail-closed behaviour", () => {
  it("refuses all mutations when disabled but still serves telemetry", () => {
    const finance = new CryptoFinanceService(sandboxConfig({ enabled: false }));
    expect(() => finance.recordEarnings(system, { agentId: "a", asset: ETH, amount: "0.01" })).toThrow(FinanceDisabledError);
    const telemetry = finance.telemetry(viewer);
    expect(telemetry.enabled).toBe(false);
    expect(telemetry.assets).toEqual([]);
  });

  it("live mode fails closed without flag, credentials, or non-zero limits", () => {
    expect(() => resolveCryptoConfig({ FINANCE_ENABLED: "true", CRYPTO_MODE: "live" })).toThrow(FinanceConfigError);
    expect(() =>
      resolveCryptoConfig({ FINANCE_ENABLED: "true", CRYPTO_MODE: "live", CRYPTO_LIVE_ENABLED: "true" }),
    ).toThrow(/CRYPTO_RPC_URL/);
    expect(() =>
      resolveCryptoConfig({
        FINANCE_ENABLED: "true",
        CRYPTO_MODE: "live",
        CRYPTO_LIVE_ENABLED: "true",
        CRYPTO_RPC_URL: "https://rpc.example",
        CRYPTO_PRIVATE_KEY: `0x${"ab".repeat(32)}`,
        CRYPTO_LIMIT_ETH_ETHEREUM_PER_TX: "0",
      }),
    ).toThrow(/non-zero spending limits/);
  });

  it("rejects unknown and mainnet-in-sandbox assets at config time", () => {
    expect(() => resolveCryptoConfig({ FINANCE_ENABLED: "true", CRYPTO_ASSETS: "DOGE.ethereum" })).toThrow(CryptoAssetError);
    expect(() => resolveCryptoConfig({ FINANCE_ENABLED: "true", CRYPTO_ASSETS: "ETH.ethereum" })).toThrow(/sandbox/i);
  });

  it("never includes credentials in the public config", () => {
    const config = resolveCryptoConfig({
      FINANCE_ENABLED: "true",
      CRYPTO_MODE: "live",
      CRYPTO_LIVE_ENABLED: "true",
      CRYPTO_RPC_URL: "https://rpc.example",
      CRYPTO_PRIVATE_KEY: `0x${"cd".repeat(32)}`,
    });
    const finance = new CryptoFinanceService(config);
    const pub = finance.publicConfig(operator);
    expect(pub.credentialsConfigured).toBe(true);
    const serialized = JSON.stringify(pub);
    expect(serialized).not.toContain("cd".repeat(32));
    expect(serialized).not.toContain("rpc.example");
  });
});

describe("authorization", () => {
  it("rejects anonymous, viewers, and insufficient roles", () => {
    const finance = new CryptoFinanceService(sandboxConfig());
    expect(() => finance.recordEarnings(anonymous, { agentId: "a", asset: ETH, amount: "0.01" })).toThrow(UnauthorizedFinanceOperationError);
    expect(() => finance.recordEarnings(viewer, { agentId: "a", asset: ETH, amount: "0.01" })).toThrow(UnauthorizedFinanceOperationError);
    expect(() => finance.entries(viewer)).toThrow(UnauthorizedFinanceOperationError);
    expect(() => finance.telemetry(anonymous)).toThrow(UnauthorizedFinanceOperationError);
  });

  it("forbids agents from approving, rejecting, or executing settlements", async () => {
    const finance = new CryptoFinanceService(sandboxConfig());
    const proposal = finance.proposeSettlement(system, {
      asset: ETH,
      amountBase: parseUnits("0.01", requireAsset(ETH)),
      toAddress: WALLET_A,
      reason: "payout",
    });
    expect(() => finance.approveSettlement(agent, proposal.id)).toThrow(UnauthorizedFinanceOperationError);
    expect(() => finance.rejectSettlement(agent, proposal.id)).toThrow(UnauthorizedFinanceOperationError);
    await expect(finance.executeSettlement(agent, proposal.id)).rejects.toThrow(UnauthorizedFinanceOperationError);
    expect(() => finance.listSettlements(viewer)).toThrow(UnauthorizedFinanceOperationError);
  });
});

describe("sandbox mode", () => {
  it("settles approved payouts on the disabled rail with full journaling and tx hash", async () => {
    const provider = new DisabledSandboxCryptoProvider();
    const finance = new CryptoFinanceService(sandboxConfig(), provider);
    finance.recordCapitalInjection(operator, ETH, "0.1");
    finance.recordEarnings(system, { agentId: "agent-7", asset: ETH, amount: "0.02", taskId: "t-1" });

    const proposal = finance.proposeSettlement(system, {
      asset: ETH,
      amountBase: parseUnits("0.01", requireAsset(ETH)),
      toAddress: WALLET_A,
      reason: "profit share",
      agentId: "agent-7",
      idempotencyKey: "payout-1",
    });
    finance.approveSettlement(operator, proposal.id);
    const settled = await finance.executeSettlement(operator, proposal.id);

    expect(settled.status).toBe("SETTLED");
    expect(settled.txHash).toMatch(/^0x/);
    expect(provider.transferCount).toBe(1);
    expect(finance.ledger.balanceOfAsset(ETH, "crypto:payable:settlements")).toBe(0n);
    expect(finance.reconcileNow(operator).ok).toBe(true);
    // Settlement payouts carry an on-chain anchor, so no unconfirmed-payout anomaly.
    expect(finance.anomalies(operator).some((a) => a.code === "UNCONFIRMED_ONCHAIN_PAYOUT")).toBe(false);
  });

  it("is idempotent across proposal retries and provider retries", async () => {
    const provider = new DisabledSandboxCryptoProvider();
    const finance = new CryptoFinanceService(sandboxConfig(), provider);
    finance.recordCapitalInjection(operator, USDC, "50");

    const a = finance.proposeSettlement(system, {
      asset: USDC,
      amountBase: parseUnits("5", requireAsset(USDC)),
      toAddress: WALLET_B,
      reason: "payout",
      idempotencyKey: "dup-1",
    });
    const b = finance.proposeSettlement(system, {
      asset: USDC,
      amountBase: parseUnits("5", requireAsset(USDC)),
      toAddress: WALLET_B,
      reason: "payout",
      idempotencyKey: "dup-1",
    });
    expect(b.id).toBe(a.id);
    expect(finance.listSettlements(operator)).toHaveLength(1);

    finance.approveSettlement(operator, a.id);
    await finance.executeSettlement(operator, a.id);
    expect(provider.transferCount).toBe(1);
  });

  it("rejects malformed destinations and mainnet assets on the sandbox rail", async () => {
    const finance = new CryptoFinanceService(sandboxConfig());
    expect(() =>
      finance.proposeSettlement(system, {
        asset: ETH,
        amountBase: 1000n,
        toAddress: "not-an-address",
        reason: "payout",
      }),
    ).toThrow(CryptoAssetError);

    await expect(
      new DisabledSandboxCryptoProvider().transfer({
        settlementId: "s-1",
        asset: "ETH.ethereum",
        amountBase: 1000n,
        toAddress: WALLET_A,
        idempotencyKey: "k",
      }),
    ).rejects.toThrow(/mainnet/i);
  });
});

describe("failed settlements and rollback", () => {
  const failingProvider: CryptoSettlementProvider = {
    id: "failing",
    mode: "sandbox",
    chains: ["sepolia"],
    transfer: () => Promise.reject(new Error("nonce too low")),
  };

  it("releases the hold and marks FAILED when the provider fails", async () => {
    const finance = new CryptoFinanceService(sandboxConfig(), failingProvider);
    finance.recordCapitalInjection(operator, ETH, "0.1");
    const custodyBefore = finance.ledger.balanceOfAsset(ETH, "crypto:custody");

    const proposal = finance.proposeSettlement(system, {
      asset: ETH,
      amountBase: parseUnits("0.02", requireAsset(ETH)),
      toAddress: WALLET_A,
      reason: "payout",
    });
    finance.approveSettlement(operator, proposal.id);
    const result = await finance.executeSettlement(operator, proposal.id);

    expect(result.status).toBe("FAILED");
    expect(result.failureReason).toBe("nonce too low");
    expect(finance.ledger.balanceOfAsset(ETH, "crypto:custody")).toBe(custodyBefore);
    expect(finance.ledger.balanceOfAsset(ETH, "crypto:payable:settlements")).toBe(0n);
    expect(finance.reconcileNow(operator).ok).toBe(true);
  });

  it("cannot execute unapproved or terminal settlements", async () => {
    const finance = new CryptoFinanceService(sandboxConfig());
    const proposal = finance.proposeSettlement(system, {
      asset: ETH,
      amountBase: parseUnits("0.01", requireAsset(ETH)),
      toAddress: WALLET_A,
      reason: "payout",
    });
    await expect(finance.executeSettlement(operator, proposal.id)).rejects.toThrow(SettlementStateError);
    finance.rejectSettlement(operator, proposal.id);
    expect(() => finance.approveSettlement(operator, proposal.id)).toThrow(SettlementStateError);
  });
});

describe("AI-agent spending limits", () => {
  it("blocks per-transaction, per-agent, and total daily limits per asset", () => {
    const finance = new CryptoFinanceService(sandboxConfig());
    finance.recordCapitalInjection(operator, ETH, "1");

    expect(() => finance.recordCost(system, { agentId: "agent-7", asset: ETH, amount: "0.06" })).toThrow(LimitExceededError);

    finance.recordCost(system, { agentId: "agent-7", asset: ETH, amount: "0.05" });
    finance.recordCost(system, { agentId: "agent-7", asset: ETH, amount: "0.05" });
    finance.recordCost(system, { agentId: "agent-7", asset: ETH, amount: "0.05" });
    finance.recordCost(system, { agentId: "agent-7", asset: ETH, amount: "0.05" });
    expect(() => finance.recordCost(system, { agentId: "agent-7", asset: ETH, amount: "0.01" })).toThrow(/per-agent daily/i);

    // USDC limits are independent of ETH spend.
    expect(() => finance.recordCost(system, { agentId: "agent-7", asset: USDC, amount: "10" })).not.toThrow();
  });

  it("fails closed when no limits are configured for an asset", () => {
    const finance = new CryptoFinanceService(sandboxConfig({ limits: {} }));
    expect(() => finance.recordCost(system, { agentId: "agent-7", asset: ETH, amount: "0.001" })).toThrow(/no spending limits/i);
  });

  it("enforces limits on settlement execution too", async () => {
    const finance = new CryptoFinanceService(sandboxConfig());
    finance.recordCapitalInjection(operator, ETH, "1");
    const proposal = finance.proposeSettlement(system, {
      asset: ETH,
      amountBase: parseUnits("0.06", requireAsset(ETH)),
      toAddress: WALLET_A,
      reason: "payout",
      agentId: "agent-7",
    });
    finance.approveSettlement(operator, proposal.id);
    await expect(finance.executeSettlement(operator, proposal.id)).rejects.toThrow(LimitExceededError);
    // Hold remains intact: still APPROVED, not failed.
    expect(finance.listSettlements(operator)[0].status).toBe("APPROVED");
  });
});

describe("crypto telemetry surface", () => {
  it("exposes only aggregates per asset to authorized viewers", () => {
    const finance = new CryptoFinanceService(sandboxConfig());
    finance.recordCapitalInjection(operator, ETH, "0.5");
    finance.recordEarnings(system, { agentId: "agent-7", asset: ETH, amount: "0.1" });
    finance.recordCost(system, { agentId: "agent-7", asset: ETH, amount: "0.02", category: "compute" });
    finance.proposeSettlement(system, {
      asset: ETH,
      amountBase: parseUnits("0.05", requireAsset(ETH)),
      toAddress: WALLET_A,
      reason: "payout",
    });

    const telemetry = finance.telemetry(viewer);
    const eth = telemetry.assets.find((a) => a.asset === ETH);
    expect(eth?.revenue).toBe("0.1");
    expect(eth?.costs).toBe("0.02");
    expect(eth?.profitLoss).toBe("0.08");
    expect(eth?.pendingSettlements).toEqual({ count: 1, total: "0.05" });
    expect(telemetry.ledgerHealth).toBe("ok");

    const serialized = JSON.stringify(telemetry);
    expect(serialized).not.toContain(WALLET_A.slice(2));
    expect(serialized).not.toContain("agent-7");
  });
});
