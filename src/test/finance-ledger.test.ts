import { describe, expect, it } from "vitest";
import { FinancialLedger } from "@/finance/ledger";
import { ACCOUNT_IDS } from "@/finance/accounts";
import { reconcile, detectAnomalies } from "@/finance/reconciliation";
import { toMinorUnits } from "@/finance/money";

const revenueEntry = (amount: number, key?: string) => ({
  kind: "revenue" as const,
  lines: [
    { account: "cash:operating" as const, amount },
    { account: "revenue:task-payouts" as const, amount: -amount },
  ],
  provenance: { agentId: "agent-1", taskId: "task-1" },
  idempotencyKey: key,
});

describe("financial ledger invariants", () => {
  it("commits balanced entries and tracks balances", () => {
    const ledger = new FinancialLedger();
    ledger.post(revenueEntry(toMinorUnits(25)));
    ledger.post({
      kind: "cost",
      lines: [
        { account: "expense:compute", amount: toMinorUnits(7) },
        { account: "cash:operating", amount: -toMinorUnits(7) },
      ],
    });

    expect(ledger.size).toBe(2);
    expect(ledger.balanceOf("cash:operating")).toBe(toMinorUnits(18));
    expect(ledger.balanceOf("revenue:task-payouts")).toBe(-toMinorUnits(25));
    expect(ledger.balanceOf("expense:compute")).toBe(toMinorUnits(7));
    expect(ledger.verifyIntegrity()).toEqual([]);
  });

  it("rejects unbalanced entries without writing anything", () => {
    const ledger = new FinancialLedger();
    expect(() =>
      ledger.post({
        kind: "revenue",
        lines: [
          { account: "cash:operating", amount: 100 },
          { account: "revenue:task-payouts", amount: -99 },
        ],
      }),
    ).toThrowError(/unbalanced/i);
    expect(ledger.size).toBe(0);
  });

  it("rejects single-sided and zero-amount entries", () => {
    const ledger = new FinancialLedger();
    expect(() =>
      ledger.post({ kind: "revenue", lines: [{ account: "cash:operating", amount: 5 }, { account: "expense:compute", amount: 0 }] }),
    ).toThrowError();
    expect(() =>
      ledger.post({
        kind: "revenue",
        lines: [
          { account: "cash:operating", amount: 5 },
          { account: "expense:compute", amount: 5 },
        ],
      }),
    ).toThrowError(/debit and one credit/i);
    expect(ledger.size).toBe(0);
  });

  it("rejects unknown accounts", () => {
    const ledger = new FinancialLedger();
    expect(() =>
      ledger.post({
        kind: "adjustment",
        lines: [
          { account: "cash:offshore" as never, amount: 5 },
          { account: "equity:owner-capital", amount: -5 },
        ],
      }),
    ).toThrowError(/unknown account/i);
  });

  it("applies idempotency keys exactly once", () => {
    const ledger = new FinancialLedger();
    const first = ledger.post(revenueEntry(toMinorUnits(10), "key-1"));
    const second = ledger.post(revenueEntry(toMinorUnits(10), "key-1"));
    expect(second.id).toBe(first.id);
    expect(ledger.size).toBe(1);
    expect(ledger.balanceOf("cash:operating")).toBe(toMinorUnits(10));
  });

  it("detects tampering through the hash chain", () => {
    const ledger = new FinancialLedger();
    ledger.post(revenueEntry(toMinorUnits(10)));
    ledger.post(revenueEntry(toMinorUnits(20)));

    const internal = ledger as unknown as { entries: Array<{ lines: Array<{ amount: number }> }> };
    internal.entries[0].lines[0].amount = toMinorUnits(999);

    const problems = ledger.verifyIntegrity();
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(" ")).toMatch(/hash|unbalanced/i);
  });

  it("satisfies the accounting equation after mixed postings", () => {
    const ledger = new FinancialLedger();
    ledger.post({
      kind: "capital",
      lines: [
        { account: "cash:operating", amount: toMinorUnits(1000) },
        { account: "equity:owner-capital", amount: -toMinorUnits(1000) },
      ],
    });
    ledger.post(revenueEntry(toMinorUnits(120)));
    ledger.post({
      kind: "cost",
      lines: [
        { account: "expense:compute", amount: toMinorUnits(30) },
        { account: "cash:operating", amount: -toMinorUnits(30) },
      ],
    });

    const report = reconcile(ledger);
    expect(report.ok).toBe(true);
    expect(report.accountingEquationBalanced).toBe(true);
    expect(report.balances).toHaveLength(ACCOUNT_IDS.length);
  });

  it("flags large transactions as anomalies without mutating state", () => {
    const ledger = new FinancialLedger();
    ledger.post(revenueEntry(toMinorUnits(5000)));
    const anomalies = detectAnomalies(ledger, { largeTransactionMinor: toMinorUnits(1000) });
    expect(anomalies.some((a) => a.code === "LARGE_TRANSACTION")).toBe(true);
    expect(ledger.verifyIntegrity()).toEqual([]);
  });
});
