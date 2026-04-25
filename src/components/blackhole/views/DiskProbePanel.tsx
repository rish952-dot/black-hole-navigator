import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export interface DiskSample {
  r: number; // r / r_s
  T: number; // MK
  F: number; // ×10^15 W/m²
  v: number; // c
  lambda: number; // nm
}

interface Props {
  hover: DiskSample | null;
  className?: string;
}

/**
 * Side panel that shows live readouts for the disk profiles when the user
 * hovers (or touches) any of the disk graphs. All four graphs share one cursor
 * via the `hover` prop set from the parent.
 */
export function DiskProbePanel({ hover, className }: Props) {
  return (
    <div
      className={cn(
        "flex h-full flex-col gap-2 rounded-md border border-border bg-card/40 p-3",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Cursor probe
        </div>
        <Badge
          variant="outline"
          className={cn(
            "font-mono text-[9px]",
            hover
              ? "border-primary/50 text-primary"
              : "border-border text-muted-foreground",
          )}
        >
          {hover ? "LOCKED" : "HOVER"}
        </Badge>
      </div>

      <div className="rounded border border-primary/40 bg-primary/5 px-2 py-1.5">
        <div className="font-mono text-[9px] uppercase tracking-widest text-primary/70">
          radius
        </div>
        <div className="font-mono text-base font-bold text-primary">
          {hover ? `r = ${hover.r.toFixed(2)} r_s` : "—"}
        </div>
      </div>

      <ProbeRow
        label="T(r)"
        value={hover ? hover.T.toFixed(3) : "—"}
        unit="MK"
        tone="destructive"
      />
      <ProbeRow
        label="v_orb(r)"
        value={hover ? hover.v.toFixed(3) : "—"}
        unit="c"
        tone="primary"
      />
      <ProbeRow
        label="F(r)"
        value={hover ? hover.F.toFixed(3) : "—"}
        unit="×10¹⁵ W/m²"
        tone="accent"
      />
      <ProbeRow
        label="λ_peak(r)"
        value={hover ? hover.lambda.toFixed(2) : "—"}
        unit="nm"
        tone="secondary"
      />

      <div className="mt-auto rounded border border-border bg-muted/30 p-2 font-mono text-[9px] leading-relaxed text-muted-foreground">
        Hover any disk graph to probe.
        <br />
        On touch: tap-and-drag along a curve.
      </div>
    </div>
  );
}

function ProbeRow({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  tone: "primary" | "accent" | "secondary" | "destructive";
}) {
  const toneClass = {
    primary: "border-primary/30 text-primary",
    accent: "border-accent/30 text-accent",
    secondary: "border-secondary/30 text-secondary",
    destructive: "border-destructive/30 text-destructive",
  }[tone];
  return (
    <div className={cn("rounded border bg-card/40 px-2 py-1.5", toneClass)}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-widest opacity-70">
          {label}
        </span>
        <span className="font-mono text-[9px] opacity-60">{unit}</span>
      </div>
      <div className="font-mono text-sm font-bold tabular-nums">{value}</div>
    </div>
  );
}
