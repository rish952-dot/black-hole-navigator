/**
 * Double-entry chart of accounts for the farm's financial intelligence layer.
 *
 * Conventions (mirroring the existing `farm/ledger.ts` sign convention):
 *  - ASSET / EXPENSE accounts carry debit-positive balances (increase on debit).
 *  - LIABILITY / EQUITY / REVENUE accounts carry credit-positive balances (increase on credit).
 *  - Every journal entry's debits must equal its credits.
 */

export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

export const ACCOUNT_IDS = [
  "cash:operating",
  "receivable:task-payouts",
  "payable:settlements",
  "equity:owner-capital",
  "revenue:task-payouts",
  "revenue:rewards",
  "expense:compute",
  "expense:api",
  "expense:tool",
  "expense:fees",
  "expense:penalties",
] as const;

export type AccountId = (typeof ACCOUNT_IDS)[number];

const ACCOUNT_TYPES: Record<AccountId, AccountType> = {
  "cash:operating": "ASSET",
  "receivable:task-payouts": "ASSET",
  "payable:settlements": "LIABILITY",
  "equity:owner-capital": "EQUITY",
  "revenue:task-payouts": "REVENUE",
  "revenue:rewards": "REVENUE",
  "expense:compute": "EXPENSE",
  "expense:api": "EXPENSE",
  "expense:tool": "EXPENSE",
  "expense:fees": "EXPENSE",
  "expense:penalties": "EXPENSE",
};

export function accountType(account: AccountId): AccountType {
  return ACCOUNT_TYPES[account];
}

/** True when a debit increases the account's natural balance (assets & expenses). */
export function isDebitNormal(account: AccountId): boolean {
  const type = ACCOUNT_TYPES[account];
  return type === "ASSET" || type === "EXPENSE";
}

export function isAccountId(value: string): value is AccountId {
  return (ACCOUNT_IDS as readonly string[]).includes(value);
}

/** Short human-readable reason when reconciliation finds this account off. */
export function accountLabel(account: AccountId): string {
  return account;
}
