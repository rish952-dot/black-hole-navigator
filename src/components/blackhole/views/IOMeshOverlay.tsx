import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Maximize2, ArrowRight } from "lucide-react";

interface Props {
  inputCount: number;
  hiddenCount: number;
  outputCount: number;
}

/**
 * Compact I/O mesh inspector overlay.
 *
 * Visualizes the parameter→hidden→output flow of the simulation as a
 * neural network diagram. For the deep inspector see /mesh route.
 */
export function IOMeshOverlay({ inputCount, hiddenCount, outputCount }: Props) {
  const inputs = [
    "mass", "spin", "diskInner", "diskOuter", "diskTilt",
    "doppler", "lensing", "redshift", "darkMatter", "haloScale",
    "stringDim", "frameDrag", "vectorScale",
  ];
  const outputs = ["lensing", "disk_emission", "doppler", "ergo_drag", "halo_glow", "shimmer"];

  return (
    <div className="rounded-lg border border-border bg-card/40 p-3">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-widest text-secondary">
            I/O Mesh · live signal flow
          </div>
          <div className="font-mono text-[9px] text-muted-foreground">
            {inputCount} inputs → {hiddenCount.toLocaleString()} hidden → {outputCount} outputs
          </div>
        </div>
        <Button asChild size="sm" variant="outline" className="h-7 font-mono text-[10px]">
          <Link to="/mesh">
            <Maximize2 className="mr-1 h-3 w-3" />
            Open full mesh
          </Link>
        </Button>
      </div>

      <div className="relative grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2">
        {/* Inputs */}
        <div className="space-y-0.5">
          {inputs.map((n) => (
            <div
              key={n}
              className="rounded border border-secondary/30 bg-secondary/5 px-1.5 py-0.5 text-right font-mono text-[9px] text-secondary"
            >
              {n}
            </div>
          ))}
        </div>

        <ArrowRight className="h-3 w-3 text-muted-foreground" />

        {/* Hidden — represented as stacked density blocks */}
        <div className="flex h-full flex-col items-center justify-center gap-1">
          <div className="flex w-full items-center gap-0.5">
            {Array.from({ length: 24 }).map((_, i) => {
              const intensity = 0.3 + (Math.sin(i * 1.7) + 1) * 0.35;
              return (
                <div
                  key={i}
                  className="h-12 flex-1 rounded-sm bg-primary"
                  style={{ opacity: intensity }}
                />
              );
            })}
          </div>
          <div className="font-mono text-[9px] text-primary">
            {hiddenCount.toLocaleString()} params · 6 layers
          </div>
          <div className="flex w-full items-center gap-0.5">
            {Array.from({ length: 24 }).map((_, i) => {
              const broken = i === 7 || i === 19;
              const intensity = 0.4 + (Math.cos(i * 2.1) + 1) * 0.3;
              return (
                <div
                  key={i}
                  className={`h-8 flex-1 rounded-sm ${broken ? "bg-destructive animate-pulse" : "bg-accent"}`}
                  style={{ opacity: broken ? 1 : intensity }}
                />
              );
            })}
          </div>
        </div>

        <ArrowRight className="h-3 w-3 text-muted-foreground" />

        {/* Outputs */}
        <div className="space-y-0.5">
          {outputs.map((n) => (
            <div
              key={n}
              className="rounded border border-primary/30 bg-primary/5 px-1.5 py-0.5 font-mono text-[9px] text-primary"
            >
              {n}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 font-mono text-[9px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-secondary" /> input
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-primary" /> hidden
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-accent" /> active
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-destructive animate-pulse" /> broken
        </span>
      </div>
    </div>
  );
}
