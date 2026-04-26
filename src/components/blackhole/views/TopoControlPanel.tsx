import { useState } from "react";
import { ChevronDown, ChevronUp, Sliders } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Independent multipliers / overrides for the topography field.
 * Each scalar is applied on top of the value derived from node state, so
 * the topography reacts to BOTH the selected nodes AND the user's manual
 * intent.
 *
 * curvature   — radial well depth     (0 = flat, 2 = deep funnel)
 * energy      — wave amplitude        (0 = still, 2 = stormy)
 * stability   — surface coherence     (0 = chaotic, 1 = clean)
 * flowAngle   — sweep direction (rad) (0..2π)
 * intensity   — global multiplier on all of the above (0..2)
 */
export interface TopoControls {
  enabled: boolean;
  curvature: number;
  energy: number;
  stability: number;
  flowAngle: number;
  intensity: number;
}

export const DEFAULT_TOPO_CONTROLS: TopoControls = {
  enabled: true,
  curvature: 1,
  energy: 1,
  stability: 1,
  flowAngle: 0,
  intensity: 1,
};

interface Props {
  value: TopoControls;
  onChange: (v: TopoControls) => void;
  className?: string;
}

export function TopoControlPanel({ value, onChange, className }: Props) {
  const [open, setOpen] = useState(false);
  const set = <K extends keyof TopoControls>(k: K, v: TopoControls[K]) =>
    onChange({ ...value, [k]: v });

  return (
    <div
      className={cn(
        "pointer-events-auto rounded-lg border border-border bg-black/75 backdrop-blur-md font-mono text-[11px] text-foreground shadow-lg",
        className,
      )}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 hover:bg-white/5"
      >
        <span className="flex items-center gap-2 text-secondary">
          <Sliders className="h-3 w-3" />
          <span className="uppercase tracking-widest text-[10px]">Topo Field</span>
          {!value.enabled && (
            <span className="rounded bg-muted px-1.5 text-[9px] text-muted-foreground">off</span>
          )}
        </span>
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
      </button>

      {open && (
        <div className="space-y-3 border-t border-border px-3 py-3">
          <Row label="Enable">
            <Switch
              checked={value.enabled}
              onCheckedChange={(c) => set("enabled", c)}
            />
          </Row>

          <SliderRow
            label="Intensity"
            value={value.intensity}
            min={0}
            max={2}
            step={0.05}
            onChange={(v) => set("intensity", v)}
            disabled={!value.enabled}
            display={`${value.intensity.toFixed(2)}×`}
          />
          <SliderRow
            label="Curvature"
            value={value.curvature}
            min={0}
            max={2}
            step={0.05}
            onChange={(v) => set("curvature", v)}
            disabled={!value.enabled}
            display={value.curvature.toFixed(2)}
          />
          <SliderRow
            label="Energy"
            value={value.energy}
            min={0}
            max={2}
            step={0.05}
            onChange={(v) => set("energy", v)}
            disabled={!value.enabled}
            display={value.energy.toFixed(2)}
          />
          <SliderRow
            label="Stability"
            value={value.stability}
            min={0}
            max={1}
            step={0.02}
            onChange={(v) => set("stability", v)}
            disabled={!value.enabled}
            display={value.stability.toFixed(2)}
          />
          <SliderRow
            label="Flow ∠"
            value={value.flowAngle}
            min={0}
            max={Math.PI * 2}
            step={0.05}
            onChange={(v) => set("flowAngle", v)}
            disabled={!value.enabled}
            display={`${((value.flowAngle * 180) / Math.PI).toFixed(0)}°`}
          />

          <Button
            size="sm"
            variant="outline"
            className="h-7 w-full font-mono text-[10px]"
            onClick={() => onChange(DEFAULT_TOPO_CONTROLS)}
          >
            Reset
          </Button>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  disabled,
  display,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  display: string;
}) {
  return (
    <div className={cn("space-y-1", disabled && "opacity-40")}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className="tabular-nums text-[10px] text-secondary">{display}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={([v]) => onChange(v)}
        disabled={disabled}
      />
    </div>
  );
}
