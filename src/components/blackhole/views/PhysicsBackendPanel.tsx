import { usePhysicsBackend } from "@/components/blackhole/usePhysicsBackend";
import type { BlackHoleParams } from "@/components/blackhole/BlackHoleQuad";
import { cn } from "@/lib/utils";

/**
 * PhysicsBackendPanel — surfaces server-computed analytic readouts. Acts
 * as a live "backend health" indicator for the BH module: if the panel is
 * green and updating, the edge function loop is healthy.
 */
interface Props {
  params: BlackHoleParams;
  className?: string;
}

function fmt(n: number, digits = 3): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e6 || (Math.abs(n) < 1e-3 && n !== 0)) {
    return n.toExponential(digits);
  }
  return n.toFixed(digits);
}

export function PhysicsBackendPanel({ params, className }: Props) {
  const { data, error, loading } = usePhysicsBackend(params);

  const dotColor = error
    ? "bg-destructive"
    : loading
      ? "bg-accent animate-pulse"
      : data
        ? "bg-[hsl(140_60%_55%)]"
        : "bg-muted";

  return (
    <div
      className={cn(
        "rounded-md border border-secondary/30 bg-black/60 p-3 font-mono text-[10px] leading-relaxed text-muted-foreground backdrop-blur-md",
        className,
      )}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="uppercase tracking-widest text-secondary">
          backend · physics
        </span>
        <span className="flex items-center gap-1.5 text-[9px]">
          <span className={cn("h-1.5 w-1.5 rounded-full", dotColor)} />
          {error ? "offline" : loading ? "compute…" : data ? "live" : "idle"}
        </span>
      </div>

      {error && (
        <div className="rounded border border-destructive/40 bg-destructive/10 px-1.5 py-1 text-[9px] text-destructive">
          {error}
        </div>
      )}

      {data && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums">
          <span>r_ISCO</span>
          <span className="text-primary">{fmt(data.geometric.r_isco, 3)} M</span>
          <span>ω_ISCO</span>
          <span className="text-primary">{fmt(data.geometric.omega_isco, 4)}</span>
          <span>r_s</span>
          <span className="text-primary">{fmt(data.dimensionful.r_s_km, 2)} km</span>
          <span>T_Hawking</span>
          <span className="text-primary">{fmt(data.dimensionful.hawkingTemp_K, 3)} K</span>
          <span>f_ringdown</span>
          <span className="text-primary">{fmt(data.dimensionful.gwRingdownHz, 2)} Hz</span>
          <span>τ_damp</span>
          <span className="text-primary">{fmt(data.dimensionful.ringdownDampingSec, 4)} s</span>
          <span>η_disk</span>
          <span className="text-primary">{fmt(data.disk.radiativeEfficiency, 3)}</span>
          <span>S_BH</span>
          <span className="text-primary">{fmt(data.dimensionful.bekensteinHawkingEntropy, 2)}</span>
          <span>DM contrib</span>
          <span className="text-primary">{fmt(data.darkMatter.contribution, 3)}</span>
        </div>
      )}
    </div>
  );
}
