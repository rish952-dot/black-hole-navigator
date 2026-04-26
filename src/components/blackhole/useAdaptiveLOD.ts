import { useEffect, useRef, useState } from "react";

/**
 * FPS-driven LOD tiers. Higher = better quality + higher update cadence.
 *
 *   high  — desktop, stable 55+ fps
 *   med   — laptop / mid-range, 35–55 fps
 *   low   — mobile / thermal-throttled, < 35 fps
 *
 * The hook samples the browser's frame timing via requestAnimationFrame and
 * smooths the FPS reading with an EMA. Tier transitions use hysteresis bands
 * so the system never oscillates between two tiers when the device is right
 * on the boundary.
 */
export type LODTier = "high" | "med" | "low";

export interface LODProfile {
  tier: LODTier;
  fps: number;
  /** Tessellation per axis recommended for the topo plane. */
  topoResolution: number;
  /**
   * How often (ms) the topo layer should advance its smoothing uniforms.
   * 0 = every frame. Higher values throttle CPU work without freezing visuals
   * — the GPU still renders at full rate, only the JS-side updates slow down.
   */
  topoUpdateInterval: number;
  /** Convenience flag — true when we're in the lowest tier. */
  reduced: boolean;
}

const PROFILES: Record<LODTier, Omit<LODProfile, "tier" | "fps" | "reduced">> = {
  high: { topoResolution: 128, topoUpdateInterval: 0 },
  med:  { topoResolution: 96,  topoUpdateInterval: 33 },   // ~30 Hz
  low:  { topoResolution: 56,  topoUpdateInterval: 66 },   // ~15 Hz
};

interface Options {
  /** Force a starting tier (e.g., "low" on mobile boot). */
  initialTier?: LODTier;
  /** Skip auto-adjustment entirely; useful for testing. */
  disabled?: boolean;
}

export function useAdaptiveLOD({ initialTier = "high", disabled }: Options = {}): LODProfile {
  const [tier, setTier] = useState<LODTier>(initialTier);
  const [fps, setFps] = useState(60);

  const lastTimeRef = useRef<number | null>(null);
  const emaRef = useRef(60);
  const lastTierChangeRef = useRef(0);
  const rafRef = useRef<number>();

  useEffect(() => {
    if (disabled) return;

    const tick = (t: number) => {
      const last = lastTimeRef.current;
      lastTimeRef.current = t;
      if (last !== null) {
        const dt = t - last;
        if (dt > 0 && dt < 200) {
          const instant = 1000 / dt;
          // EMA smoothing keeps the reading stable.
          emaRef.current = emaRef.current * 0.92 + instant * 0.08;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    // Sample at 1 Hz for tier decisions; that's plenty.
    const sampler = window.setInterval(() => {
      const f = emaRef.current;
      setFps(Math.round(f));

      // Hysteresis: only switch if we've been stable in the new band for
      // ~1.5 s to avoid flapping at boundaries.
      const now = performance.now();
      if (now - lastTierChangeRef.current < 1500) return;

      let next: LODTier = tier;
      if (tier === "high" && f < 38) next = "med";
      else if (tier === "med" && f < 28) next = "low";
      else if (tier === "med" && f > 55) next = "high";
      else if (tier === "low" && f > 42) next = "med";

      if (next !== tier) {
        lastTierChangeRef.current = now;
        setTier(next);
      }
    }, 1000);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      clearInterval(sampler);
    };
  }, [tier, disabled]);

  return {
    tier,
    fps,
    reduced: tier === "low",
    ...PROFILES[tier],
  };
}
