# Black Hole Navigator / AI Farm — Agent Notes

## Testing & tooling
- `npm install` requires `--legacy-peer-deps` (pre-existing conflict: `three@0.160` vs `postprocessing` peer range).
- Tests: `npm test` (vitest, jsdom, tests live in `src/test/`, alias `@/` → `src/`).
- Typecheck: `npx tsc -p tsconfig.app.json --noEmit`.
- Known pre-existing failure: `src/test/department-mesh.test.ts` ("Departments are not connected: jobs -> execution") fails on the clean base commit — unrelated to finance work.

## Finance subsystem (`src/finance/`)
Internal/private Financial Intelligence & Settlement layer. Disabled by default; enable via `FINANCE_ENABLED=true`. Default mode is `sandbox` (paper money, `SandboxSettlementProvider`); `live` additionally requires `FINANCE_LIVE_ENABLED=true` + `FINANCE_PROVIDER_API_KEY` and fails closed at config time otherwise.
- Single entry point: `FinanceService` (`service.ts`); every method is feature-flag + role gated (roles in `auth.ts`). Agents may record/propose, only `operator` may approve/execute settlements.
- Double-entry ledger (`ledger.ts`): integer minor units (1e-6, see `money.ts`), append-only, hash-chained (pure-TS SHA-256 in `hash.ts` so it runs in Node and browser), idempotency keys return the original entry.
- Settlement flow (`settlement.ts`): PROPOSED → APPROVED → SETTLED/FAILED; holds are equity/liability entries, provider failures trigger a compensating release (rollback).
- `provider.ts` is the future real-money boundary — implement `SettlementProvider` to connect an authorized provider without touching Farm/Mesh.
- `farm-bridge.ts` mirrors `farm/ledger.ts` transactions into the finance ledger (idempotent per farm tx id) and never throws into the farm loop.
- UI: only `src/components/finance/FinanceTelemetryPanel.tsx`, hidden unless `VITE_FINANCE_TELEMETRY=true`, aggregates only, no transaction detail/destinations/credentials.

### Cryptocurrency rail (`src/finance/crypto-*.ts`)
Crypto-only counterpart, same invariants and posture: separate bigint (wei) hash-chained ledger (`crypto-ledger.ts`, per-asset entries from the registered `CRYPTO_ASSETS` registry in `crypto.ts`), `crypto:*` chart of accounts (`crypto-accounts.ts`), per-asset bigint spend limits (`crypto-spend-gate.ts`, fail-closed when an asset has no limits), PROPOSED → APPROVED → SETTLED/FAILED lifecycle with compensating release (`crypto-settlement.ts`), per-asset reconciliation + crypto anomaly detection incl. payouts missing an on-chain tx hash (`crypto-reconciliation.ts`).
- Provider boundary (`crypto-provider.ts`): default `DisabledSandboxCryptoProvider` (Sepolia only, simulated tx hash, no network); `EvmCryptoProvider` validates credentials at construction and refuses to broadcast until a signer is wired in — the integration point for a real rail.
- Env: `CRYPTO_MODE=live` requires `CRYPTO_LIVE_ENABLED=true`, `CRYPTO_RPC_URL` (https/wss), `CRYPTO_PRIVATE_KEY` (0x + 32 bytes), and non-zero per-asset limits (`CRYPTO_LIMIT_<ASSET>_{PER_TX,AGENT_DAILY,TOTAL_DAILY}`, e.g. `CRYPTO_LIMIT_ETH_ETHEREUM_PER_TX=0.05`). `CRYPTO_ASSETS` selects the enabled registry keys; sandbox rejects mainnet assets.
- Facade: `CryptoFinanceService` (`crypto-service.ts`) + read-only `createCryptoFinanceApi` (`crypto-api.ts`); telemetry is per-asset aggregates only (custody/revenue/costs/P&L/pending/spend-today), no addresses/tx hashes/credentials.

## Existing finance modules (do not duplicate)
- `src/farm/ledger.ts`: simulation bookkeeping for the evolution engine (kept simulation-local).
- `src/farm/payment-manager.ts` / `payment-ledger.ts`: approval-gated paper payment proposals used by `central-mind.ts` and `hosting-screener.ts`.
- `src/farm/settlement.ts`: EVM settlement proposal shapes (used by `scripts/create-settlement-proposals.ts`).
- `scripts/finance-flow.ts`, `scripts/real-money-flow.ts`: Bun + ethers real-money scripts; already fail-closed (`FINANCE_REAL_MONEY`, allow-listed destination, daily/per-tx caps, audit jsonl).
