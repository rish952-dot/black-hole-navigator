import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Snowflake,
  Flame,
  Unlink2,
  Link2,
  Crosshair,
  X,
  Zap,
  ZapOff,
  Layers,
  Box,
  Bug,
} from "lucide-react";

export interface NodeState {
  index: number;
  frozen: boolean;
  isolated: boolean;
  boost: number; // -1 (dampen) .. +1 (amplify), 0 = neutral
}

export interface NodeFieldReadout {
  /** position in tapestry units */
  pos: [number, number, number];
  /** distance from tapestry center, normalized */
  rNorm: number;
  /** mock black-hole-linked field samples (geometric units) */
  potential: number;
  redshift: number;
  tidal: number;
  edgeCount: number;
  brokenEdges: number;
}

export interface LayerToggles {
  mesh: boolean;
  fourD: boolean;
  debug: boolean;
}

interface Props {
  state: NodeState | null;
  field: NodeFieldReadout | null;
  layers: LayerToggles;
  onLayersChange: (next: LayerToggles) => void;
  onFreeze: () => void;
  onIsolate: () => void;
  onBoost: (v: number) => void;
  onFocus: () => void;
  onClear: () => void;
  className?: string;
}

/**
 * Node inspector for the Neural Tapestry.
 * Lightweight overlay — no portals, no global state, all wiring via props.
 */
export function NodeInspectorPanel({
  state,
  field,
  layers,
  onLayersChange,
  onFreeze,
  onIsolate,
  onBoost,
  onFocus,
  onClear,
  className,
}: Props) {
  const open = state !== null && field !== null;
  return (
    <div
      className={cn(
        "pointer-events-auto flex w-[260px] flex-col gap-2 rounded-lg border border-border bg-black/80 p-3 backdrop-blur-md",
        className,
      )}
    >
      {/* Layer toggles always visible */}
      <div className="flex items-center justify-between gap-1">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Layers
        </span>
        <div className="flex gap-1">
          <LayerBtn
            on={layers.mesh}
            onClick={() => onLayersChange({ ...layers, mesh: !layers.mesh })}
            icon={<Layers className="h-3 w-3" />}
            label="Mesh"
          />
          <LayerBtn
            on={layers.fourD}
            onClick={() => onLayersChange({ ...layers, fourD: !layers.fourD })}
            icon={<Box className="h-3 w-3" />}
            label="4D"
          />
          <LayerBtn
            on={layers.debug}
            onClick={() => onLayersChange({ ...layers, debug: !layers.debug })}
            icon={<Bug className="h-3 w-3" />}
            label="Dbg"
          />
        </div>
      </div>

      <div className="h-px bg-border" />

      {!open ? (
        <div className="rounded border border-border bg-muted/20 p-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
          <div className="mb-1 text-secondary">NODE INSPECTOR</div>
          Tap or click any parameter node to inspect, freeze, isolate, or
          amplify. Broken connections shown red.
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="border-primary/50 font-mono text-[10px] text-primary">
              Node #{state!.index}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={onClear}
              aria-label="Close inspector"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
            <Field label="x" value={field!.pos[0].toFixed(2)} />
            <Field label="y" value={field!.pos[1].toFixed(2)} />
            <Field label="z" value={field!.pos[2].toFixed(2)} />
            <Field label="r/R" value={field!.rNorm.toFixed(3)} />
            <Field label="Φ" value={field!.potential.toFixed(3)} tone="primary" />
            <Field label="z_g" value={field!.redshift.toFixed(3)} tone="accent" />
            <Field label="τ" value={field!.tidal.toExponential(2)} tone="secondary" />
            <Field
              label="edges"
              value={`${field!.edgeCount}${field!.brokenEdges ? ` ⚠${field!.brokenEdges}` : ""}`}
              tone={field!.brokenEdges > 0 ? "destructive" : undefined}
            />
          </div>

          <div className="grid grid-cols-3 gap-1 pt-1">
            <ActionBtn
              active={state!.frozen}
              onClick={onFreeze}
              icon={<Snowflake className="h-3 w-3" />}
              label={state!.frozen ? "Thaw" : "Freeze"}
              tone="primary"
            />
            <ActionBtn
              active={state!.isolated}
              onClick={onIsolate}
              icon={state!.isolated ? <Link2 className="h-3 w-3" /> : <Unlink2 className="h-3 w-3" />}
              label={state!.isolated ? "Reconnect" : "Isolate"}
              tone="destructive"
            />
            <ActionBtn
              active={false}
              onClick={onFocus}
              icon={<Crosshair className="h-3 w-3" />}
              label="Focus"
              tone="accent"
            />
          </div>

          <div className="space-y-1.5 rounded border border-border bg-muted/20 px-2 py-1.5">
            <div className="flex items-center justify-between font-mono text-[10px]">
              <span className="flex items-center gap-1 text-muted-foreground">
                {state!.boost >= 0 ? (
                  <Flame className="h-3 w-3 text-accent" />
                ) : (
                  <ZapOff className="h-3 w-3 text-secondary" />
                )}
                Influence
              </span>
              <span
                className={cn(
                  "font-bold tabular-nums",
                  state!.boost > 0 && "text-accent",
                  state!.boost < 0 && "text-secondary",
                  state!.boost === 0 && "text-muted-foreground",
                )}
              >
                {state!.boost > 0 ? "+" : ""}
                {(state!.boost * 100).toFixed(0)}%
              </span>
            </div>
            <Slider
              value={[state!.boost]}
              min={-1}
              max={1}
              step={0.05}
              onValueChange={(v) => onBoost(v[0])}
            />
            <div className="flex justify-between gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 flex-1 font-mono text-[9px]"
                onClick={() => onBoost(-0.6)}
              >
                <ZapOff className="mr-1 h-3 w-3" /> Dampen
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 flex-1 font-mono text-[9px]"
                onClick={() => onBoost(0)}
              >
                Reset
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 flex-1 font-mono text-[9px]"
                onClick={() => onBoost(0.8)}
              >
                <Zap className="mr-1 h-3 w-3" /> Boost
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function LayerBtn({
  on,
  onClick,
  icon,
  label,
}: {
  on: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Button
      size="sm"
      variant={on ? "default" : "outline"}
      className="h-6 gap-1 px-1.5 font-mono text-[9px]"
      onClick={onClick}
    >
      {icon}
      {label}
    </Button>
  );
}

function ActionBtn({
  active,
  onClick,
  icon,
  label,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  tone: "primary" | "accent" | "destructive";
}) {
  const toneClass = {
    primary: active ? "bg-primary text-primary-foreground" : "border-primary/40 text-primary",
    accent: active ? "bg-accent text-accent-foreground" : "border-accent/40 text-accent",
    destructive: active
      ? "bg-destructive text-destructive-foreground"
      : "border-destructive/40 text-destructive",
  }[tone];
  return (
    <Button
      size="sm"
      variant={active ? "default" : "outline"}
      className={cn("h-7 flex-col gap-0 px-1 font-mono text-[9px]", toneClass)}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </Button>
  );
}

function Field({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "primary" | "accent" | "secondary" | "destructive";
}) {
  const toneClass = tone
    ? {
        primary: "text-primary border-primary/30",
        accent: "text-accent border-accent/30",
        secondary: "text-secondary border-secondary/30",
        destructive: "text-destructive border-destructive/30",
      }[tone]
    : "text-foreground border-border";
  return (
    <div className={cn("rounded border bg-card/40 px-1.5 py-1", toneClass)}>
      <div className="text-[8px] uppercase tracking-widest opacity-60">{label}</div>
      <div className="text-[11px] font-bold tabular-nums">{value}</div>
    </div>
  );
}
