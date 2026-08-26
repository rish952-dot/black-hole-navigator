/**
 * Reconciliation and anomaly detection over the immutable journal.
 *
 * Reconciliation recomputes account balances from scratch and compares them
 * with the ledger's running view, then verifies the hash chain. Anomaly
 * detection is a lightweight heuristic layer that flags suspicious patterns
 * for operator review; it never mutates state.
 */

import type { FinancialLedger, JournalEntry } from "./ledger";
import { ACCOUNT_IDS, accountType, isDebitNormal, type AccountId } from "./accounts";
import { fromMinorUnits } from "./money";

export interface ReconciliationReport {
  ok: boolean;
  checkedAt: string;
  entryCount: number;
  integrityProblems: string[];
  balances: Array<{ account: AccountId; type: string; balanceMinor: number }>;
  totalAssetsMinor: number;
  totalLiabilitiesAndEquityMinor: number;
  accountingEquationBalanced: boolean;
}

export type AnomalySeverity = "info" | "warning" | "critical";

export interface Anomaly {
  code: string;
  severity: AnomalySeverity;
  message: string;
  entryId?: string;
}

export function reconcile(ledger: FinancialLedger): ReconciliationReport {
  const integrityProblems = ledger.verifyIntegrity();
  const entries = ledger.all();

  const balances = ACCOUNT_IDS.map((account) => ({
    account,
    type: accountType(account),
    balanceMinor: balanceFromEntries(entries, account),
  }));

  // Accounting equation in natural signs: Assets = Liabilities + Equity + (Revenue − Expenses).
  let assets = 0;
  let liabilitiesAndEquity = 0;
  for (const { account, balanceMinor } of balances) {
    const natural = isDebitNormal(account) ? balanceMinor : -balanceMinor;
    const type = accountType(account);
    if (type === "ASSET") assets += natural;
    else if (type === "EXPENSE") liabilitiesAndEquity -= natural;
    else liabilitiesAndEquity += natural; // LIABILITY, EQUITY, REVENUE
  }

  const accountingEquationBalanced = assets === liabilitiesAndEquity;

  return {
    ok: integrityProblems.length === 0 && accountingEquationBalanced,
    checkedAt: new Date().toISOString(),
    entryCount: entries.length,
    integrityProblems,
    balances,
    totalAssetsMinor: assets,
    totalLiabilitiesAndEquityMinor: liabilitiesAndEquity,
    accountingEquationBalanced,
  };
}

function balanceFromEntries(entries: JournalEntry[], account: AccountId): number {
  let balance = 0;
  for (const entry of entries) {
    for (const line of entry.lines) {
      if (line.account === account) balance += line.amount;
    }
  }
  return balance;
}

export interface AnomalyOptions {
  /** Single-transaction size beyond this is flagged. Minor units. */
  largeTransactionMinor?: number;
  /** More than this many entries per minute from one agent is flagged. */
  maxAgentEntriesPerMinute?: number;
}

export function detectAnomalies(ledger: FinancialLedger, options: AnomalyOptions = {}): Anomaly[] {
  const largeTransactionMinor = options.largeTransactionMinor ?? 1_000_000_000; // 1,000 units
  const maxAgentEntriesPerMinute = options.maxAgentEntriesPerMinute ?? 60;

  const anomalies: Anomaly[] = [];
  const entries = ledger.all();

  for (const entry of entries) {
    const largest = Math.max(...entry.lines.map((line) => Math.abs(line.amount)));
    if (largest > largeTransactionMinor) {
      anomalies.push({
        code: "LARGE_TRANSACTION",
        severity: "warning",
        message: `Entry ${entry.id} moves ${fromMinorUnits(largest).toFixed(2)} units, above the review threshold`,
        entryId: entry.id,
      });
    }
    if (entry.kind === "settlement_release") {
      anomalies.push({
        code: "SETTLEMENT_RELEASED",
        severity: "info",
        message: `Settlement hold released for ${entry.provenance.settlementId ?? "unknown settlement"} (${entry.provenance.note ?? "no note"})`,
        entryId: entry.id,
      });
    }
  }

  // Agent burst detection.
  const perAgentMinute = new Map<string, number>();
  for (const entry of entries) {
    const agentId = entry.provenance.agentId;
    if (!agentId) continue;
    const minute = entry.timestamp.slice(0, 16); // YYYY-MM-DDTHH:MM
    const key = `${agentId}|${minute}`;
    const count = (perAgentMinute.get(key) ?? 0) + 1;
    perAgentMinute.set(key, count);
    if (count === maxAgentEntriesPerMinute + 1) {
      anomalies.push({
        code: "AGENT_BURST",
        severity: "warning",
        message: `Agent ${agentId} produced more than ${maxAgentEntriesPerMinute} ledger entries within one minute`,
      });
    }
  }

  if (ledger.verifyIntegrity().length > 0) {
    anomalies.push({
      code: "LEDGER_INTEGRITY",
      severity: "critical",
      message: "Ledger hash chain verification failed; treat all financial state as suspect",
    });
  }

  return anomalies;
}
