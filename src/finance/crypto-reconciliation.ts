/**
 * Reconciliation and anomaly detection over the crypto journal.
 * Per asset: recompute balances, verify the accounting equation, and check
 * the hash chain. Anomaly detection additionally flags crypto-specific
 * patterns (unconfirmed on-chain payouts, gas-heavy entries).
 */

import type { CryptoJournalEntry, CryptoLedger } from "./crypto-ledger";
import { CRYPTO_ACCOUNT_IDS, cryptoAccountType, isCryptoDebitNormal, type CryptoAccountId } from "./crypto-accounts";
import { CRYPTO_ASSETS, formatUnits, requireAsset, type AssetKey } from "./crypto";

export interface CryptoAccountBalance {
  account: CryptoAccountId;
  type: string;
  /** Signed base units as a decimal string (bigint-safe). */
  balanceBase: string;
  /** Human units, e.g. "1.5" ETH. */
  balanceFormatted: string;
}

export interface CryptoAssetReport {
  asset: AssetKey;
  accountingEquationBalanced: boolean;
  balances: CryptoAccountBalance[];
}

export interface CryptoReconciliationReport {
  ok: boolean;
  checkedAt: string;
  entryCount: number;
  integrityProblems: string[];
  perAsset: CryptoAssetReport[];
}

export type CryptoAnomalySeverity = "info" | "warning" | "critical";

export interface CryptoAnomaly {
  code: string;
  severity: CryptoAnomalySeverity;
  message: string;
  entryId?: string;
}

export function reconcileCrypto(ledger: CryptoLedger): CryptoReconciliationReport {
  const integrityProblems = ledger.verifyIntegrity();
  const entries = ledger.all();
  const assetsSeen = new Set<AssetKey>();
  for (const entry of entries) assetsSeen.add(entry.asset);

  const perAsset: CryptoAssetReport[] = [...assetsSeen].sort().map((assetKey) => {
    const asset = requireAsset(assetKey);
    const balances = CRYPTO_ACCOUNT_IDS.map((account) => {
      let balance = 0n;
      for (const entry of entries) {
        if (entry.asset !== assetKey) continue;
        for (const line of entry.lines) {
          if (line.account === account) balance += line.amount;
        }
      }
      return {
        account,
        type: cryptoAccountType(account),
        balanceBase: balance.toString(),
        balanceFormatted: formatUnits(balance, asset),
      };
    });

    let assetsTotal = 0n;
    let liabilitiesAndEquity = 0n;
    for (const { account, balanceBase } of balances) {
      const signed = BigInt(balanceBase);
      const natural = isCryptoDebitNormal(account) ? signed : -signed;
      const type = cryptoAccountType(account);
      if (type === "ASSET") assetsTotal += natural;
      else if (type === "EXPENSE") liabilitiesAndEquity -= natural;
      else liabilitiesAndEquity += natural; // LIABILITY, EQUITY, REVENUE
    }

    return { asset: assetKey, accountingEquationBalanced: assetsTotal === liabilitiesAndEquity, balances };
  });

  return {
    ok: integrityProblems.length === 0 && perAsset.every((report) => report.accountingEquationBalanced),
    checkedAt: new Date().toISOString(),
    entryCount: entries.length,
    integrityProblems,
    perAsset,
  };
}

export interface CryptoAnomalyOptions {
  /** Entries at or above this fraction (basis points) of the custody balance are flagged. */
  largeTransactionBps?: number;
  /** More than this many entries per minute from one agent is flagged. */
  maxAgentEntriesPerMinute?: number;
}

export function detectCryptoAnomalies(ledger: CryptoLedger, options: CryptoAnomalyOptions = {}): CryptoAnomaly[] {
  const largeBps = BigInt(options.largeTransactionBps ?? 5000); // 50% of custody
  const maxAgentEntriesPerMinute = options.maxAgentEntriesPerMinute ?? 60;

  const anomalies: CryptoAnomaly[] = [];
  const entries = ledger.all();
  const custodyByAsset = new Map<AssetKey, bigint>();
  for (const entry of entries) {
    for (const line of entry.lines) {
      if (line.account === "crypto:custody") {
        custodyByAsset.set(entry.asset, (custodyByAsset.get(entry.asset) ?? 0n) + line.amount);
      }
    }
  }

  for (const entry of entries) {
    const asset = requireAsset(entry.asset);
    const largest = entry.lines.reduce((max, line) => (line.amount > max ? line.amount : max), 0n);
    const custody = custodyByAsset.get(entry.asset) ?? 0n;
    const threshold = custody > 0n ? (custody * largeBps) / 10_000n : 10n ** BigInt(asset.decimals);
    if (largest >= threshold && largest > 0n) {
      anomalies.push({
        code: "LARGE_CRYPTO_TRANSACTION",
        severity: "warning",
        message: `Entry ${entry.id} moves ${formatUnits(largest, asset)} ${asset.symbol} (${entry.asset}), above the review threshold`,
        entryId: entry.id,
      });
    }
    if (entry.kind === "crypto_settlement_release") {
      anomalies.push({
        code: "CRYPTO_SETTLEMENT_RELEASED",
        severity: "info",
        message: `Crypto settlement hold released for ${entry.provenance.settlementId ?? "unknown settlement"} (${entry.provenance.note ?? "no note"})`,
        entryId: entry.id,
      });
    }
    if (entry.kind === "crypto_settlement_payout" && !entry.provenance.txHash) {
      anomalies.push({
        code: "UNCONFIRMED_ONCHAIN_PAYOUT",
        severity: "critical",
        message: `Entry ${entry.id} records a crypto settlement payout without an on-chain transaction hash`,
        entryId: entry.id,
      });
    }
  }

  const perAgentMinute = new Map<string, number>();
  for (const entry of entries) {
    const agentId = entry.provenance.agentId;
    if (!agentId) continue;
    const key = `${agentId}|${entry.timestamp.slice(0, 16)}`;
    const count = (perAgentMinute.get(key) ?? 0) + 1;
    perAgentMinute.set(key, count);
    if (count === maxAgentEntriesPerMinute + 1) {
      anomalies.push({
        code: "AGENT_BURST",
        severity: "warning",
        message: `Agent ${agentId} produced more than ${maxAgentEntriesPerMinute} crypto ledger entries within one minute`,
      });
    }
  }

  if (ledger.verifyIntegrity().length > 0) {
    anomalies.push({
      code: "LEDGER_INTEGRITY",
      severity: "critical",
      message: "Crypto ledger hash chain verification failed; treat all financial state as suspect",
    });
  }

  return anomalies;
}
