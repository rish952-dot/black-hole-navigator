/**
 * Crypto chart of accounts, parallel to the fiat-oriented `accounts.ts`.
 * Crypto activity is namespaced under `crypto:*` so the existing subsystem
 * and its reconciliation are never affected by on-chain movements.
 *
 * Same sign convention: assets/expenses are debit-normal, liabilities/
 * equity/revenue are credit-normal, and every journal entry balances.
 */

export type CryptoAccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";

export const CRYPTO_ACCOUNT_IDS = [
  "crypto:custody",
  "crypto:payable:settlements",
  "crypto:equity:owner-capital",
  "crypto:revenue:task-payouts",
  "crypto:revenue:rewards",
  "crypto:expense:compute",
  "crypto:expense:api",
  "crypto:expense:fees",
  "crypto:expense:gas",
] as const;

export type CryptoAccountId = (typeof CRYPTO_ACCOUNT_IDS)[number];

const CRYPTO_ACCOUNT_TYPES: Record<CryptoAccountId, CryptoAccountType> = {
  "crypto:custody": "ASSET",
  "crypto:payable:settlements": "LIABILITY",
  "crypto:equity:owner-capital": "EQUITY",
  "crypto:revenue:task-payouts": "REVENUE",
  "crypto:revenue:rewards": "REVENUE",
  "crypto:expense:compute": "EXPENSE",
  "crypto:expense:api": "EXPENSE",
  "crypto:expense:fees": "EXPENSE",
  "crypto:expense:gas": "EXPENSE",
};

export function cryptoAccountType(account: CryptoAccountId): CryptoAccountType {
  return CRYPTO_ACCOUNT_TYPES[account];
}

export function isCryptoDebitNormal(account: CryptoAccountId): boolean {
  const type = CRYPTO_ACCOUNT_TYPES[account];
  return type === "ASSET" || type === "EXPENSE";
}

export function isCryptoAccountId(value: string): value is CryptoAccountId {
  return (CRYPTO_ACCOUNT_IDS as readonly string[]).includes(value);
}
