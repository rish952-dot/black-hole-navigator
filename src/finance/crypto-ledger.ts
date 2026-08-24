/**
 * Immutable, hash-chained double-entry ledger for crypto assets.
 *
 * Mirrors the invariants of `ledger.ts` but operates on bigint base units
 * (wei) and tags every entry with a registered crypto asset:
 *  - every line's account must be a `crypto:*` account,
 *  - all lines of an entry share one asset, debits === credits in base units,
 *  - idempotency keys apply at most once (safe retries),
 *  - append-only, SHA-256 hash chain for tamper evidence.
 */

import { sha256Hex } from "./hash";
import { isCryptoAccountId, type CryptoAccountId } from "./crypto-accounts";
import { requireAsset, type AssetKey } from "./crypto";
import { LedgerInvariantError } from "./errors";

export type CryptoPostingKind =
  | "crypto_revenue"
  | "crypto_cost"
  | "crypto_reward"
  | "crypto_gas"
  | "crypto_capital"
  | "crypto_settlement_hold"
  | "crypto_settlement_release"
  | "crypto_settlement_payout"
  | "crypto_adjustment";

export interface CryptoJournalLine {
  account: CryptoAccountId;
  /** Signed base units: positive = debit, negative = credit. */
  amount: bigint;
}

export interface CryptoJournalLineDto {
  account: CryptoAccountId;
  /** Decimal string of signed base units (bigint-safe over the wire). */
  amount: string;
}

export interface CryptoJournalProvenance {
  agentId?: string;
  jobId?: string;
  taskId?: string;
  opportunityId?: string;
  generation?: number;
  settlementId?: string;
  txHash?: string;
  source?: string;
  note?: string;
}

export interface CryptoJournalEntry {
  id: string;
  sequence: number;
  timestamp: string;
  kind: CryptoPostingKind;
  asset: AssetKey;
  lines: CryptoJournalLine[];
  provenance: CryptoJournalProvenance;
  idempotencyKey?: string;
  hash: string;
  prevHash: string;
}

export interface PostCryptoJournalInput {
  kind: CryptoPostingKind;
  asset: AssetKey;
  lines: CryptoJournalLine[];
  provenance?: CryptoJournalProvenance;
  idempotencyKey?: string;
  timestamp?: string;
}

const GENESIS_HASH = "GENESIS";

function canonical(entry: Omit<CryptoJournalEntry, "hash" | "prevHash">): string {
  return JSON.stringify(entry, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value));
}

export class CryptoLedger {
  private entries: CryptoJournalEntry[] = [];
  private byIdempotencyKey = new Map<string, CryptoJournalEntry>();
  private counter = 0;

  post(input: PostCryptoJournalInput): CryptoJournalEntry {
    requireAsset(input.asset);
    const lines = input.lines.map((line) => ({ ...line }));
    if (lines.length < 2) {
      throw new LedgerInvariantError("A journal entry requires at least two lines (debit and credit)");
    }

    let net = 0n;
    let hasDebit = false;
    let hasCredit = false;
    for (const line of lines) {
      if (!isCryptoAccountId(line.account)) {
        throw new LedgerInvariantError(`Unknown crypto account: ${line.account}`);
      }
      if (line.amount === 0n) {
        throw new LedgerInvariantError("Journal line amounts must be non-zero (base units)");
      }
      net += line.amount;
      if (line.amount > 0n) hasDebit = true;
      else hasCredit = true;
    }
    if (!hasDebit || !hasCredit) {
      throw new LedgerInvariantError("A journal entry requires at least one debit and one credit line");
    }
    if (net !== 0n) {
      throw new LedgerInvariantError(`Journal entry is unbalanced by ${net} base units (debits must equal credits)`);
    }

    if (input.idempotencyKey) {
      const existing = this.byIdempotencyKey.get(input.idempotencyKey);
      if (existing) return existing;
    }

    const sequence = this.counter;
    const base: Omit<CryptoJournalEntry, "hash" | "prevHash"> = {
      id: `fin-crypto-tx-${sequence}`,
      sequence,
      timestamp: input.timestamp ?? new Date().toISOString(),
      kind: input.kind,
      asset: input.asset,
      lines,
      provenance: { ...(input.provenance ?? {}) },
      idempotencyKey: input.idempotencyKey,
    };
    const prevHash = this.entries.length ? this.entries[this.entries.length - 1].hash : GENESIS_HASH;
    const entry: CryptoJournalEntry = {
      ...base,
      hash: sha256Hex(prevHash + canonical(base)),
      prevHash,
    };

    this.entries.push(entry);
    this.counter += 1;
    if (input.idempotencyKey) this.byIdempotencyKey.set(input.idempotencyKey, entry);
    return this.copy(entry);
  }

  all(): CryptoJournalEntry[] {
    return this.entries.map((entry) => this.copy(entry));
  }

  get size(): number {
    return this.entries.length;
  }

  /** Net signed base units posted to a crypto account (debit-positive). */
  balanceOf(account: CryptoAccountId): bigint {
    let balance = 0n;
    for (const entry of this.entries) {
      for (const line of entry.lines) {
        if (line.account === account) balance += line.amount;
      }
    }
    return balance;
  }

  /** Net signed base units for one account within a single asset. */
  balanceOfAsset(asset: AssetKey, account: CryptoAccountId): bigint {
    let balance = 0n;
    for (const entry of this.entries) {
      if (entry.asset !== asset) continue;
      for (const line of entry.lines) {
        if (line.account === account) balance += line.amount;
      }
    }
    return balance;
  }

  /** Recompute and verify the hash chain. Empty result means healthy. */
  verifyIntegrity(): string[] {
    const problems: string[] = [];
    let prevHash = GENESIS_HASH;
    for (const entry of this.entries) {
      if (entry.prevHash !== prevHash) {
        problems.push(`entry ${entry.id}: broken hash chain`);
      }
      const { hash: _hash, prevHash: _prev, ...rest } = entry;
      const expected = sha256Hex(entry.prevHash + canonical(rest));
      if (expected !== entry.hash) {
        problems.push(`entry ${entry.id}: hash mismatch (possible tampering)`);
      }
      const net = entry.lines.reduce((sum, line) => sum + line.amount, 0n);
      if (net !== 0n) problems.push(`entry ${entry.id}: unbalanced`);
      prevHash = entry.hash;
    }
    return problems;
  }

  private copy(entry: CryptoJournalEntry): CryptoJournalEntry {
    return { ...entry, lines: entry.lines.map((line) => ({ ...line })), provenance: { ...entry.provenance } };
  }
}
