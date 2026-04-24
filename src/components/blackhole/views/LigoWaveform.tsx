import { useMemo, useState } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { LIGO_EVENTS, generateStrain, type LigoEvent } from "../data/ligo-events";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Props {
  onSelectEvent?: (event: LigoEvent) => void;
}

/**
 * LIGO strain waveform viewer with selectable real events.
 * Wired into spacetime grid as a ripple source.
 */
export function LigoWaveform({ onSelectEvent }: Props) {
  const [selected, setSelected] = useState<LigoEvent>(LIGO_EVENTS[0]);
  const data = useMemo(() => generateStrain(selected, 800), [selected]);

  const handleSelect = (e: LigoEvent) => {
    setSelected(e);
    onSelectEvent?.(e);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {LIGO_EVENTS.map((e) => (
          <Button
            key={e.id}
            size="sm"
            variant={selected.id === e.id ? "default" : "outline"}
            className="h-7 font-mono text-[10px]"
            onClick={() => handleSelect(e)}
          >
            {e.name}
          </Button>
        ))}
      </div>

      <div className="rounded-md border border-border bg-card/40 p-3">
        <div className="mb-2 flex items-start justify-between">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-widest text-primary">
              {selected.name} — strain h(t)
            </div>
            <div className="font-mono text-[9px] text-muted-foreground">
              {selected.date} · {selected.type} · {selected.distance_mpc} Mpc
            </div>
          </div>
          <Badge variant="outline" className="border-secondary/50 font-mono text-[10px] text-secondary">
            SNR {selected.snr}
          </Badge>
        </div>

        <div className="h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" />
              <XAxis
                dataKey="t"
                tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(v) => v.toFixed(2)}
                label={{
                  value: "t (s, merger=0)",
                  fontSize: 9,
                  fill: "hsl(var(--muted-foreground))",
                  position: "insideBottom",
                  offset: -2,
                }}
              />
              <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  fontSize: 10,
                  fontFamily: "monospace",
                }}
                formatter={(v: number) => v.toExponential(2)}
              />
              <ReferenceLine x={0} stroke="hsl(var(--accent))" strokeDasharray="3 3" />
              <Line
                type="monotone"
                dataKey="h"
                stroke="hsl(var(--secondary))"
                strokeWidth={1.4}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[9px] text-muted-foreground">
          <div>m₁ = <span className="text-primary">{selected.m1}</span> M☉</div>
          <div>m₂ = <span className="text-primary">{selected.m2}</span> M☉</div>
          <div>m_f = <span className="text-accent">{selected.m_final}</span> M☉</div>
          <div>a_f = <span className="text-secondary">{selected.a_final}</span></div>
          <div>d = {selected.distance_mpc} Mpc</div>
          <div>η = {((selected.m1 * selected.m2) / Math.pow(selected.m1 + selected.m2, 2)).toFixed(3)}</div>
        </div>

        <p className="mt-2 font-mono text-[9px] leading-relaxed text-muted-foreground">
          {selected.notes}
        </p>
      </div>
    </div>
  );
}
