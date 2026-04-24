import { useMemo } from "react";
import type { BlackHoleParams } from "../BlackHoleQuad";

interface Props {
  params: BlackHoleParams;
  vectorScale: number;
}

/**
 * Underlying Data Matrix.
 *
 * Renders the simulation's full state as a structured table: the raw
 * input vector, derived metric scalars, and the 4×4 spacetime tensor
 * approximation g_μν along the equatorial plane at r=10 r_s.
 */
export function DataMatrix({ params, vectorScale }: Props) {
  const r_s = 2 * params.mass;
  const r_isco = 6 * params.mass;
  const r_photon = 3 * params.mass;
  const r_eval = 10 * params.mass;

  // Schwarzschild metric components at r_eval (signature -+++)
  const g = useMemo(() => {
    const r = r_eval;
    const f = 1 - r_s / r;
    return {
      tt: -f,
      rr: 1 / f,
      thth: r * r,
      phph: r * r, // sin²(π/2)=1
    };
  }, [r_eval, r_s]);

  const inputs: [string, number, string][] = [
    ["mass", params.mass, "M☉"],
    ["spin a/M", params.spin, ""],
    ["frame_drag", params.frameDrag, ""],
    ["disk_inner", params.diskInner, "r_s"],
    ["disk_outer", params.diskOuter, "r_s"],
    ["disk_tilt", params.diskTilt, "rad"],
    ["doppler", params.doppler, ""],
    ["lensing", params.lensing, ""],
    ["redshift", params.redshift, ""],
    ["dark_matter", params.darkMatter, ""],
    ["halo_scale", params.haloScale, "r_s"],
    ["string_dim", params.stringDim, ""],
    ["vector_scale", vectorScale, "×"],
  ];

  return (
    <div className="space-y-3 rounded-md border border-border bg-card/40 p-3 font-mono text-[10px]">
      <div>
        <div className="mb-2 font-mono text-[11px] uppercase tracking-widest text-primary">
          INPUT VECTOR · {inputs.length}D
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 md:grid-cols-3">
          {inputs.map(([k, v, u]) => (
            <div key={k} className="flex items-baseline justify-between border-b border-border/40 py-0.5">
              <span className="text-muted-foreground">{k}</span>
              <span className="text-foreground">
                {v.toFixed(3)}
                <span className="ml-0.5 text-muted-foreground">{u}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 font-mono text-[11px] uppercase tracking-widest text-secondary">
          DERIVED METRIC SCALARS
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 md:grid-cols-4">
          <Cell k="r_s" v={r_s.toFixed(4)} u="M" />
          <Cell k="r_ISCO" v={r_isco.toFixed(4)} u="M" />
          <Cell k="r_photon" v={r_photon.toFixed(4)} u="M" />
          <Cell k="v_ISCO" v={Math.sqrt(1 / 6).toFixed(4)} u="c" />
          <Cell k="ω_ergo" v={(params.spin * 0.5).toFixed(4)} u="" />
          <Cell k="A_horizon" v={(4 * Math.PI * r_s * r_s).toFixed(2)} u="M²" />
          <Cell k="T_Hawking" v={(1 / (8 * Math.PI * params.mass)).toExponential(2)} u="" />
          <Cell k="S/k_B" v={(Math.PI * r_s * r_s).toFixed(2)} u="" />
        </div>
      </div>

      <div>
        <div className="mb-2 font-mono text-[11px] uppercase tracking-widest text-accent">
          g_μν AT r = 10M (Schwarzschild)
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="text-muted-foreground">
                <th className="border border-border/60 bg-muted/30 px-2 py-1 text-left">μ\ν</th>
                <th className="border border-border/60 bg-muted/30 px-2 py-1">t</th>
                <th className="border border-border/60 bg-muted/30 px-2 py-1">r</th>
                <th className="border border-border/60 bg-muted/30 px-2 py-1">θ</th>
                <th className="border border-border/60 bg-muted/30 px-2 py-1">φ</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["t", g.tt, 0, 0, 0],
                ["r", 0, g.rr, 0, 0],
                ["θ", 0, 0, g.thth, 0],
                ["φ", 0, 0, 0, g.phph],
              ].map((row, i) => (
                <tr key={i}>
                  <td className="border border-border/60 bg-muted/30 px-2 py-1 text-muted-foreground">{row[0]}</td>
                  {(row.slice(1) as number[]).map((cell, j) => (
                    <td
                      key={j}
                      className={`border border-border/60 px-2 py-1 text-right ${
                        cell !== 0 ? "text-primary" : "text-muted-foreground/40"
                      }`}
                    >
                      {cell === 0 ? "0" : (cell as number).toFixed(3)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[9px] leading-relaxed text-muted-foreground">
          ds² = −(1 − r_s/r) dt² + (1 − r_s/r)⁻¹ dr² + r² dΩ²
        </p>
      </div>
    </div>
  );
}

function Cell({ k, v, u }: { k: string; v: string; u: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-border/40 py-0.5">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-foreground">
        {v}
        {u && <span className="ml-0.5 text-muted-foreground">{u}</span>}
      </span>
    </div>
  );
}
