import { useMemo } from "react";

/**
 * StreamlineOverlay — fluid/aerodynamic flow lines that visualize the
 * accretion + frame-dragging field around the black hole.
 *
 * Pure presentational SVG. Sits absolutely over the WebGL canvas with
 * pointer-events disabled so touch gestures still reach OrbitControls.
 *
 * The lines are co-rotating logarithmic spirals (think Kerr ergosphere flow):
 *   r(θ) = r0 · exp(b · θ)
 * with b derived from spin so high-spin BHs draw tighter wraps. Stroke dash
 * animation conveys flow direction; counter-spin lines below the disk plane
 * show frame-dragging asymmetry.
 */
interface Props {
  /** 0..1+ — controls spiral tightness (Kerr-like wrap rate). */
  spin: number;
  /** 0..2 — frame-dragging multiplier. Drives counter-flow brightness. */
  frameDrag: number;
  /** number of streamlines per disk side (above + below plane). */
  count?: number;
  /** disk tilt in radians — flattens the spiral ellipse. */
  tilt?: number;
  /** master opacity (0 hides everything). */
  intensity?: number;
  className?: string;
}

interface Streamline {
  d: string;
  hue: number;
  duration: number;
  delay: number;
  width: number;
  opacity: number;
}

function buildSpiral(
  cx: number,
  cy: number,
  r0: number,
  rMax: number,
  b: number,
  tiltY: number,
  thetaStart: number,
  thetaEnd: number,
  steps = 64,
): string {
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const theta = thetaStart + (thetaEnd - thetaStart) * t;
    const r = Math.min(rMax, r0 * Math.exp(b * (theta - thetaStart)));
    const x = cx + Math.cos(theta) * r;
    const y = cy + Math.sin(theta) * r * tiltY;
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return d;
}

export function StreamlineOverlay({
  spin,
  frameDrag,
  count = 14,
  tilt = 1.05,
  intensity = 1,
  className,
}: Props) {
  const lines = useMemo<Streamline[]>(() => {
    if (intensity <= 0) return [];
    const W = 400;
    const H = 400;
    const cx = W / 2;
    const cy = H / 2;
    // Tighter spirals for high spin. Sign flips for counter-flow under disk.
    const b = 0.05 + spin * 0.18;
    // sin(tilt) gives the visual flatness of the disk plane.
    const tiltY = Math.max(0.18, Math.abs(Math.sin(tilt)));

    const out: Streamline[] = [];
    for (let i = 0; i < count; i++) {
      const angOffset = (i / count) * Math.PI * 2;
      const r0 = 26 + (i % 4) * 4; // start near ISCO
      const rMax = 180;
      // Co-rotating spiral above plane — warm orange/red.
      out.push({
        d: buildSpiral(cx, cy, r0, rMax, b, tiltY, angOffset, angOffset + Math.PI * 2.4),
        hue: 18 + (i * 7) % 22, // orange→amber
        duration: 6 + (i % 5) * 1.2,
        delay: -((i * 0.37) % 6),
        width: 0.9 + (i % 3) * 0.25,
        opacity: 0.55 + (i % 3) * 0.12,
      });
      // Counter-flow streamline below plane (frame-dragging hint) — cyan.
      if (frameDrag > 0.05) {
        out.push({
          d: buildSpiral(
            cx,
            cy,
            r0 + 6,
            rMax,
            -b * 0.7,
            tiltY * 0.85,
            angOffset + Math.PI,
            angOffset + Math.PI - Math.PI * 1.8,
          ),
          hue: 190,
          duration: 8 + (i % 4) * 1.4,
          delay: -((i * 0.51) % 8),
          width: 0.7,
          opacity: Math.min(0.55, 0.18 + frameDrag * 0.22),
        });
      }
    }
    return out;
  }, [spin, frameDrag, count, tilt, intensity]);

  if (intensity <= 0) return null;

  return (
    <svg
      viewBox="0 0 400 400"
      preserveAspectRatio="xMidYMid slice"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className ?? ""}`}
      style={{ opacity: intensity, mixBlendMode: "screen" }}
      aria-hidden
    >
      <defs>
        {/* Radial fade so lines vanish near event horizon and at edges. */}
        <radialGradient id="bh-streamline-fade" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="black" stopOpacity="0" />
          <stop offset="18%" stopColor="white" stopOpacity="1" />
          <stop offset="78%" stopColor="white" stopOpacity="1" />
          <stop offset="100%" stopColor="black" stopOpacity="0" />
        </radialGradient>
        <mask id="bh-streamline-mask">
          <rect width="400" height="400" fill="url(#bh-streamline-fade)" />
        </mask>
      </defs>

      <g mask="url(#bh-streamline-mask)" fill="none" strokeLinecap="round">
        {lines.map((l, i) => (
          <path
            key={i}
            d={l.d}
            stroke={`hsl(${l.hue} 95% 65%)`}
            strokeWidth={l.width}
            strokeOpacity={l.opacity}
            strokeDasharray="3 9"
            style={{
              animation: `bh-streamflow ${l.duration}s linear ${l.delay}s infinite`,
              filter: "drop-shadow(0 0 1.5px currentColor)",
            }}
          />
        ))}
      </g>

      <style>{`
        @keyframes bh-streamflow {
          from { stroke-dashoffset: 0; }
          to   { stroke-dashoffset: -120; }
        }
      `}</style>
    </svg>
  );
}
