/**
 * Immutable, hash-chained double-entry ledger.
 *
 * Invariants enforced at write time:
 *  - every entry has at least one debit and one credit line,
 *  - sum(debits) === sum(credits) in integer minor units,
 *  - amounts are positive safe integers,
 *  - an idempotency key can be applied at most once,
 *  - entries are append-only: no update or delete API exists,
 *  - each entry's hash chains to the previous entry (tamper evidence).
 */

import { sha256Hex } from "./hash";
import { isAccountId, type AccountId } from "./accounts";
import { LedgerInvariantError } from "./errors";
import { fromMinorUnits, isValidMinorAmount } from "./money";

export type PostingKind =
  | "revenue"
  | "cost"
  | "fee"
  | "reward"
  | "penalty"
  | "capital"
  | "settlement_hold"
  | "settlement_release"
  | "settlement_payout"
  | "adjustment";

export interface JournalLine {
  account: AccountId;
  /** Signed minor units: positive = debit, negative = credit. */
  amount: number;
}

export interface JournalProvenance {
  agentId?: string;
  jobId?: string;
  taskId?: string;
  opportunityId?: string;
  generation?: number;
  settlementId?: string;
  source?: string;
  note?: string;
}

export interface JournalEntry {
  id: string;
  sequence: number;
  timestamp: string;
  kind: PostingKind;
  /** Sum of all line amounts. Always 0 for committed entries. */
  netMinor: number;
  lines: JournalLine[];
  provenance: JournalProvenance;
  idempotencyKey?: string;
  /** SHA-256 of the canonical serialization of this entry (without hash/prevHash). */
  hash: string;
  prevHash: string;
}

export interface PostJournalInput {
  kind: PostingKind;
  lines: JournalLine[];
  provenance?: JournalProvenance;
  idempotencyKey?: string;
  timestamp?: string;
}

const GENESIS_HASH = "GENESIS";

function canonical(entry: Omit<JournalEntry, "hash" | "prevHash">): string {
  return JSON.stringify(entry);
}

export class FinancialLedger {
  private entries: JournalEntry[] = [];
  private byIdempotencyKey = new Map<string, JournalEntry>();
  private counter = 0;

  /**
   * Append a balanced journal entry. Returns the existing entry unchanged
   * when the idempotency key was already applied (safe retries).
   */
  post(input: PostJournalInput): JournalEntry {
    const lines = input.lines.map((line) => ({ ...line }));
    if (lines.length < 2) {
      throw new LedgerInvariantError("A journal entry requires at least two lines (debit and credit)");
    }

    let net = 0;
    let hasDebit = false;
    let hasCredit = false;
    for (const line of lines) {
      if (!isAccountId(line.account)) {
        throw new LedgerInvariantError(`Unknown account: ${line.account}`);
      }
      if (!Number.isSafeInteger(line.amount) || line.amount === 0) {
        throw new LedgerInvariantError("Journal line amounts must be non-zero integers (minor units)");
      }
      if (!isValidMinorAmount(Math.abs(line.amount))) {
        throw new LedgerInvariantError("Journal line amounts exceed safe range");
      }
      net += line.amount;
      if (line.amount > 0) hasDebit = true;
      else hasCredit = true;
    }
    if (!hasDebit || !hasCredit) {
      throw new LedgerInvariantError("A journal entry requires at least one debit and one credit line");
    }
    if (net !== 0) {
      throw new LedgerInvariantError(
        `Journal entry is unbalanced by ${fromMinorUnits(net)} (debits must equal credits)`,
      );
    }

    if (input.idempotencyKey) {
      const existing = this.byIdempotencyKey.get(input.idempotencyKey);
      if (existing) return existing;
    }

    const sequence = this.counter;
    const base: Omit<JournalEntry, "hash" | "prevHash"> = {
      id: `fin-tx-${sequence}`,
      sequence,
      timestamp: input.timestamp ?? new Date().toISOString(),
      kind: input.kind,
      netMinor: 0,
      lines,
      provenance: { ...(input.provenance ?? {}) },
      idempotencyKey: input.idempotencyKey,
    };
    const prevHash = this.entries.length ? this.entries[this.entries.length - 1].hash : GENESIS_HASH;
    const entry: JournalEntry = {
      ...base,
      hash: sha256Hex(prevHash + canonical(base)),
      prevHash,
    };

    this.entries.push(entry);
    this.counter += 1;
    if (input.idempotencyKey) this.byIdempotencyKey.set(input.idempotencyKey, entry);
    return this.freeze(entry);
  }

  /** All entries in insertion order (defensive copies). */
  all(): JournalEntry[] {
    return this.entries.map((entry) => this.freeze(entry));
  }

  get size(): number {
    return this.entries.length;
  }

  /** Net signed minor units posted to an account (debit-positive). */
  balanceOf(account: AccountId): number {
    let balance = 0;
    for (const entry of this.entries) {
      for (const line of entry.lines) {
        if (line.account === account) balance += line.amount;
      }
    }
    return balance;
  }

  /**
   * Recompute balances from scratch and verify the hash chain. Returns the
   * list of integrity problems found (empty when the ledger is healthy).
   */
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
      const net = entry.lines.reduce((sum, line) => sum + line.amount, 0);
      if (net !== 0) problems.push(`entry ${entry.id}: unbalanced`);
      prevHash = entry.hash;
    }
    return problems;
  }

  private freeze(entry: JournalEntry): JournalEntry {
    return { ...entry, lines: entry.lines.map((line) => ({ ...line })), provenance: { ...entry.provenance } };
  }
}
