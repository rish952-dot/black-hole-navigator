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

## Existing finance modules (do not duplicate)
- `src/farm/ledger.ts`: simulation bookkeeping for the evolution engine (kept simulation-local).
- `src/farm/payment-manager.ts` / `payment-ledger.ts`: approval-gated paper payment proposals used by `central-mind.ts` and `hosting-screener.ts`.
- `src/farm/settlement.ts`: EVM settlement proposal shapes (used by `scripts/create-settlement-proposals.ts`).
- `scripts/finance-flow.ts`, `scripts/real-money-flow.ts`: Bun + ethers real-money scripts; already fail-closed (`FINANCE_REAL_MONEY`, allow-listed destination, daily/per-tx caps, audit jsonl).
