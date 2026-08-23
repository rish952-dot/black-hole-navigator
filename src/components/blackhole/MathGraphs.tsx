import { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";

interface Props {
  mass: number;
  spin: number;
  diskInner: number;
  diskOuter: number;
  darkMatter: number;
  haloScale: number;
}

type GraphPoint = {
  r: number;
  Veff: number;
  T: number;
  redshift: number;
  DM: number;
};

type ChartKey = keyof GraphPoint;

export function MathGraphs({
  mass,
  spin,
  diskInner,
  diskOuter,
  darkMatter,
  haloScale,
}: Props) {
  const r_s = 2 * mass;

  const data = useMemo<GraphPoint[]>(() => {
    const arr: GraphPoint[] = [];
    const r_in = diskInner * r_s;
    const rh = haloScale * r_s;
    for (let i = 0; i < 120; i++) {
      const r = r_s * 1.05 + (i / 119) * (diskOuter * r_s * 1.5);
      const L = 4 * mass;
      const Veff =
        (1 - r_s / r) * (1 + (L * L) / (r * r)) - 1;
      const cutoff = r > r_in ? 1 - Math.sqrt(r_in / r) : 0;
      const T = Math.pow(r / r_s, -0.75) * Math.max(cutoff, 0) * 100;
      const redshift = r > r_s ? Math.sqrt(1 - r_s / r) : 0;
      const x = r / rh;
      const Menc = darkMatter * (Math.log(1 + x) - x / (1 + x));
      arr.push({
        r: +(r / r_s).toFixed(2),
        Veff: +Veff.toFixed(4),
        T: +T.toFixed(3),
        redshift: +redshift.toFixed(3),
        DM: +Menc.toFixed(3),
      });
    }
    return arr;
  }, [mass, diskInner, diskOuter, darkMatter, haloScale, r_s]);

  return (
    <div className="space-y-4">
      <Chart title="V_eff(r) — Geodesic effective potential" subtitle="Schwarzschild + dark-matter halo" data={data} keys={[{ key: "Veff", color: "hsl(var(--primary))", name: "V_eff" }]} />
      <Chart title="T(r) — Disk temperature (Shakura-Sunyaev)" subtitle={`Inner edge ${diskInner.toFixed(1)} r_s`} data={data} keys={[{ key: "T", color: "hsl(var(--accent))", name: "T(r) ∝ r^-3/4" }]} />
      <Chart title="z(r) — Gravitational redshift" subtitle="√(1 - r_s/r)" data={data} keys={[{ key: "redshift", color: "hsl(var(--secondary))", name: "shift" }]} />
      <Chart title="M_DM(r) — NFW enclosed dark matter" subtitle={`ρ ∝ 1/[(r/r_s)(1+r/r_s)²]  ·  spin a/M=${spin.toFixed(2)}`} data={data} keys={[{ key: "DM", color: "hsl(280 80% 70%)", name: "M_DM" }]} />
    </div>
  );
}

function Chart({
  title,
  subtitle,
  data,
  keys,
}: {
  title: string;
  subtitle?: string;
  data: GraphPoint[];
  keys: { key: ChartKey; color: string; name: string }[];
}) {
  return (
    <div className="rounded-md border border-border bg-card/40 p-3">
      <div className="mb-2">
        <div className="font-mono text-[11px] uppercase tracking-widest text-primary">{title}</div>
        {subtitle && <div className="font-mono text-[9px] text-muted-foreground">{subtitle}</div>}
      </div>
      <div className="h-[140px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" />
            <XAxis dataKey="r" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} label={{ value: "r / r_s", fontSize: 9, fill: "hsl(var(--muted-foreground))", position: "insideBottom", offset: -2 }} />
            <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
            <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", fontSize: 10, fontFamily: "monospace" }} />
            <Legend wrapperStyle={{ fontSize: 9, fontFamily: "monospace" }} />
            {keys.map((k) => (
              <Line key={k.key} type="monotone" dataKey={k.key} stroke={k.color} strokeWidth={1.6} dot={false} name={k.name} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
