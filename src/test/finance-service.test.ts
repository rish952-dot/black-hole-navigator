import { describe, expect, it } from "vitest";
import { FinanceService } from "@/finance/service";
import { FarmFinanceBridge } from "@/finance/farm-bridge";
import { resolveFinanceConfig, DEFAULT_FINANCE_LIMITS, type FinanceConfig } from "@/finance/config";
import { Principals } from "@/finance/auth";
import { SandboxSettlementProvider, type SettlementProvider } from "@/finance/provider";
import { toMinorUnits } from "@/finance/money";
import {
  FinanceConfigError,
  FinanceDisabledError,
  LimitExceededError,
  SettlementStateError,
  UnauthorizedFinanceOperationError,
} from "@/finance/errors";
import type { Transaction } from "@/farm/types";

const sandboxConfig = (overrides: Partial<FinanceConfig> = {}): FinanceConfig => ({
  enabled: true,
  mode: "sandbox",
  liveEnabled: false,
  limits: { ...DEFAULT_FINANCE_LIMITS },
  providerCredentials: null,
  ...overrides,
});

const system = Principals.system();
const operator = Principals.operator("admin-1");
const agent = Principals.agent("agent-7");
const viewer = Principals.viewer("mesh-ui");
const anonymous = Principals.anonymous();

describe("feature flag & fail-closed behaviour", () => {
  it("refuses all mutations when disabled", () => {
    const finance = new FinanceService(sandboxConfig({ enabled: false }));
    expect(() => finance.recordEarnings(system, { agentId: "a", amount: 1 })).toThrow(FinanceDisabledError);
    expect(() => finance.proposeSettlement(system, { amountMinor: 1, asset: "USD", destination: "x", reason: "r" })).toThrow(FinanceDisabledError);
  });

  it("still serves safe telemetry when disabled", () => {
    const finance = new FinanceService(sandboxConfig({ enabled: false }));
    const telemetry = finance.telemetry(viewer);
    expect(telemetry.enabled).toBe(false);
    expect(telemetry.revenue).toBe(0);
  });

  it("live mode without live flag or credentials fails closed at config time", () => {
    expect(() => resolveFinanceConfig({ FINANCE_ENABLED: "true", FINANCE_MODE: "live" })).toThrow(FinanceConfigError);
    expect(() =>
      resolveFinanceConfig({ FINANCE_ENABLED: "true", FINANCE_MODE: "live", FINANCE_LIVE_ENABLED: "true" }),
    ).toThrow(/FINANCE_PROVIDER_API_KEY/);
    expect(() =>
      resolveFinanceConfig({
        FINANCE_ENABLED: "true",
        FINANCE_MODE: "live",
        FINANCE_LIVE_ENABLED: "true",
        FINANCE_PROVIDER_API_KEY: "sk-test",
        FINANCE_MAX_PER_TX: "0",
      }),
    ).toThrow(/spending limits/);
  });

  it("never includes credentials in the public config", () => {
    const config = resolveFinanceConfig({
      FINANCE_ENABLED: "true",
      FINANCE_MODE: "live",
      FINANCE_LIVE_ENABLED: "true",
      FINANCE_PROVIDER_API_KEY: "sk-test",
    });
    const finance = new FinanceService(config);
    const pub = finance.publicConfig(operator);
    expect(pub.providerConfigured).toBe(true);
    expect(JSON.stringify(pub)).not.toContain("sk-test");
  });
});

describe("authorization", () => {
  it("rejects anonymous and insufficient principals", () => {
    const finance = new FinanceService(sandboxConfig());
    expect(() => finance.recordEarnings(anonymous, { agentId: "a", amount: 1 })).toThrow(UnauthorizedFinanceOperationError);
    expect(() => finance.recordEarnings(viewer, { agentId: "a", amount: 1 })).toThrow(UnauthorizedFinanceOperationError);
    expect(() => finance.entries(viewer)).toThrow(UnauthorizedFinanceOperationError);
    expect(() => finance.telemetry(anonymous)).toThrow(UnauthorizedFinanceOperationError);
  });

  it("forbids agents from approving or executing settlements", () => {
    const finance = new FinanceService(sandboxConfig());
    const proposal = finance.proposeSettlement(system, {
      amountMinor: toMinorUnits(10),
      asset: "USD",
      destination: "acct:worker-1",
      reason: "payout",
    });
    expect(() => finance.approveSettlement(agent, proposal.id)).toThrow(UnauthorizedFinanceOperationError);
    expect(() => finance.rejectSettlement(agent, proposal.id)).toThrow(UnauthorizedFinanceOperationError);
    void expect(finance.executeSettlement(agent, proposal.id)).rejects.toThrow(UnauthorizedFinanceOperationError);
    // Viewer cannot even see transaction detail.
    expect(() => finance.listSettlements(viewer)).toThrow(UnauthorizedFinanceOperationError);
  });
});

describe("sandbox mode", () => {
  it("settles approved payouts through the sandbox provider with full journaling", async () => {
    const provider = new SandboxSettlementProvider();
    const finance = new FinanceService(sandboxConfig(), provider);
    finance.recordCapitalInjection(operator, 100);
    finance.recordEarnings(system, { agentId: "agent-7", amount: 40, taskId: "t-1" });

    const proposal = finance.proposeSettlement(system, {
      amountMinor: toMinorUnits(15),
      asset: "USD",
      destination: "acct:agent-7",
      reason: "profit share",
      agentId: "agent-7",
      idempotencyKey: "payout-1",
    });
    expect(proposal.status).toBe("PROPOSED");

    const approved = finance.approveSettlement(operator, proposal.id);
    expect(approved.approvedBy).toBe("admin-1");

    const settled = await finance.executeSettlement(operator, proposal.id);
    expect(settled.status).toBe("SETTLED");
    expect(settled.providerReference).toContain("sandbox:");
    expect(provider.transferCount).toBe(1);
    expect(finance.reconcileNow(operator).ok).toBe(true);
    // Liability cleared after payout.
    expect(finance.ledger.balanceOf("payable:settlements")).toBe(0);
  });

  it("is idempotent across proposal retries and provider retries", async () => {
    const provider = new SandboxSettlementProvider();
    const finance = new FinanceService(sandboxConfig(), provider);
    finance.recordCapitalInjection(operator, 50);

    const a = finance.proposeSettlement(system, {
      amountMinor: toMinorUnits(5),
      asset: "USD",
      destination: "acct:x",
      reason: "payout",
      idempotencyKey: "dup-1",
    });
    const b = finance.proposeSettlement(system, {
      amountMinor: toMinorUnits(5),
      asset: "USD",
      destination: "acct:x",
      reason: "payout",
      idempotencyKey: "dup-1",
    });
    expect(b.id).toBe(a.id);
    expect(finance.listSettlements(operator)).toHaveLength(1);

    finance.approveSettlement(operator, a.id);
    await finance.executeSettlement(operator, a.id);
    expect(provider.transferCount).toBe(1);
  });
});

describe("failed settlements and rollback", () => {
  const failingProvider: SettlementProvider = {
    id: "failing",
    mode: "sandbox",
    transfer: () => Promise.reject(new Error("provider unavailable")),
  };

  it("releases the hold and marks the settlement FAILED when the provider fails", async () => {
    const finance = new FinanceService(sandboxConfig(), failingProvider);
    finance.recordCapitalInjection(operator, 100);
    const cashBefore = finance.ledger.balanceOf("cash:operating");

    const proposal = finance.proposeSettlement(system, {
      amountMinor: toMinorUnits(20),
      asset: "USD",
      destination: "acct:y",
      reason: "payout",
    });
    finance.approveSettlement(operator, proposal.id);

    const result = await finance.executeSettlement(operator, proposal.id);
    expect(result.status).toBe("FAILED");
    expect(result.failureReason).toBe("provider unavailable");
    // Compensating release restored operating cash and cleared the liability.
    expect(finance.ledger.balanceOf("cash:operating")).toBe(cashBefore);
    expect(finance.ledger.balanceOf("payable:settlements")).toBe(0);
    expect(finance.reconcileNow(operator).ok).toBe(true);
  });

  it("cannot execute unapproved or terminal settlements", async () => {
    const finance = new FinanceService(sandboxConfig());
    const proposal = finance.proposeSettlement(system, {
      amountMinor: toMinorUnits(5),
      asset: "USD",
      destination: "acct:z",
      reason: "payout",
    });
    await expect(finance.executeSettlement(operator, proposal.id)).rejects.toThrow(SettlementStateError);

    finance.rejectSettlement(operator, proposal.id);
    expect(finance.ledger.balanceOf("payable:settlements")).toBe(0);
    expect(() => finance.approveSettlement(operator, proposal.id)).toThrow(SettlementStateError);
  });
});

describe("AI-agent spending limits", () => {
  const tightConfig = () =>
    sandboxConfig({
      limits: {
        maxPerTransaction: toMinorUnits(10),
        maxPerAgentPerDay: toMinorUnits(25),
        maxTotalPerDay: toMinorUnits(40),
      },
    });

  it("blocks per-transaction, per-agent, and total daily limits", () => {
    const finance = new FinanceService(tightConfig());
    expect(() => finance.recordCost(system, { agentId: "agent-7", amount: 11 })).toThrow(LimitExceededError);

    finance.recordCost(system, { agentId: "agent-7", amount: 10 });
    finance.recordCost(system, { agentId: "agent-7", amount: 10 });
    expect(() => finance.recordCost(system, { agentId: "agent-7", amount: 10 })).toThrow(/per-agent daily/i);

    finance.recordCost(system, { agentId: "agent-8", amount: 10 });
    finance.recordCost(system, { agentId: "agent-9", amount: 10 });
    expect(() => finance.recordCost(system, { agentId: "agent-10", amount: 1 })).toThrow(/total daily/i);
  });

  it("enforces limits on settlement execution too", async () => {
    const finance = new FinanceService(tightConfig());
    finance.recordCapitalInjection(operator, 100);
    const proposal = finance.proposeSettlement(system, {
      amountMinor: toMinorUnits(15),
      asset: "USD",
      destination: "acct:w",
      reason: "payout",
      agentId: "agent-7",
    });
    finance.approveSettlement(operator, proposal.id);
    await expect(finance.executeSettlement(operator, proposal.id)).rejects.toThrow(LimitExceededError);
    // Hold remains intact: the settlement is still approved, not failed.
    expect(finance.listSettlements(operator)[0].status).toBe("APPROVED");
  });
});

describe("telemetry surface", () => {
  it("exposes only aggregates to authorized viewers", () => {
    const finance = new FinanceService(sandboxConfig());
    finance.recordCapitalInjection(operator, 200);
    finance.recordEarnings(system, { agentId: "agent-7", amount: 50 });
    finance.recordCost(system, { agentId: "agent-7", amount: 12.5, category: "compute" });
    finance.proposeSettlement(system, {
      amountMinor: toMinorUnits(20),
      asset: "USD",
      destination: "acct:secret-destination",
      reason: "payout",
    });

    const telemetry = finance.telemetry(viewer);
    expect(telemetry.revenue).toBeCloseTo(50);
    expect(telemetry.costs).toBeCloseTo(12.5);
    expect(telemetry.profitLoss).toBeCloseTo(37.5);
    expect(telemetry.pendingSettlements).toEqual({ count: 1, total: 20 });
    expect(telemetry.ledgerHealth).toBe("ok");

    const serialized = JSON.stringify(telemetry);
    expect(serialized).not.toContain("secret-destination");
    expect(serialized).not.toContain("agent-7");
  });
});

describe("farm bridge", () => {
  const tx = (overrides: Partial<Transaction>): Transaction => ({
    id: "tx-1",
    agentId: "agent-7",
    generation: 3,
    ts: Date.now(),
    type: "task_payout",
    amount: 42,
    description: "coding payout",
    ...overrides,
  });

  it("mirrors farm revenue/cost events into the finance ledger idempotently", () => {
    const finance = new FinanceService(sandboxConfig());
    const bridge = new FarmFinanceBridge(finance);

    bridge.mirror(tx({ id: "tx-a" }));
    bridge.mirror(tx({ id: "tx-a" })); // replay is a no-op
    bridge.mirror(tx({ id: "tx-b", type: "compute_cost", amount: -9 }));
    bridge.mirror(tx({ id: "tx-c", type: "initial_capital", amount: 1000 })); // simulation-local

    expect(finance.ledger.size).toBe(2);
    const telemetry = finance.telemetry(operator);
    expect(telemetry.revenue).toBeCloseTo(42);
    expect(telemetry.costs).toBeCloseTo(9);
  });

  it("never interrupts the farm when finance is disabled", () => {
    const finance = new FinanceService(sandboxConfig({ enabled: false }));
    const bridge = new FarmFinanceBridge(finance);
    expect(() => bridge.mirror(tx({}))).not.toThrow();
  });
});
