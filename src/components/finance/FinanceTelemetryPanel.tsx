import type { FinanceTelemetry } from "@/finance";

/**
 * Aggregate-only finance telemetry widget for authorized Mesh/Admin views.
 *
 * Deliberately hidden unless VITE_FINANCE_TELEMETRY=true is set at build
 * time. It renders only sanitized aggregate data (revenue/cost/P&L/pending
 * settlements/risk/ledger health) supplied by a host data source — it has
 * no access to transactions, destinations, or credentials, and no mutation
 * surface of any kind.
 */
export function FinanceTelemetryPanel({
  telemetry,
  authorized,
}: {
  telemetry: FinanceTelemetry | null;
  authorized: boolean;
}) {
  if (import.meta.env.VITE_FINANCE_TELEMETRY !== "true") return null;
  if (!authorized || !telemetry || !telemetry.enabled) return null;

  const rows: Array<[string, string]> = [
    ["Revenue", telemetry.revenue.toFixed(2)],
    ["Cost", telemetry.costs.toFixed(2)],
    ["P/L", telemetry.profitLoss.toFixed(2)],
    ["Pending settlements", `${telemetry.pendingSettlements.count} (${telemetry.pendingSettlements.total.toFixed(2)})`],
    ["Risk", telemetry.riskState],
    ["Ledger", telemetry.ledgerHealth],
  ];

  return (
    <section
      aria-label="Finance telemetry"
      className="rounded-lg border border-cyan-400/15 bg-black/50 px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-cyan-100/70"
    >
      <header className="mb-1 text-cyan-300/60">
        Finance · {telemetry.mode} · aggregates only
      </header>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-2">
            <dt className="text-cyan-100/45">{label}</dt>
            <dd className="text-cyan-100">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
