import { useEffect, useState } from "react";
import { AI_FN_BASE, AI_PUB_KEY } from "./useAINodes";
import type { BlackHoleParams } from "./BlackHoleQuad";

/**
 * usePhysicsBackend — debounced POST to the blackhole-physics edge
 * function. Returns analytic readouts (Hawking T, ISCO, ringdown Hz, ...)
 * computed server-side so the same numbers feed the AI prompts and any
 * future logging/sharing without duplicating math in the client.
 */
export interface PhysicsReadout {
  ok: boolean;
  ts: number;
  geometric: {
    r_s: number;
    r_isco: number;
    r_photon: number;
    omega_isco: number;
  };
  dimensionful: {
    r_s_km: number;
    hawkingTemp_K: number;
    bekensteinHawkingEntropy: number;
    gwRingdownHz: number;
    ringdownDampingSec: number;
    eddingtonLuminosity_W: number;
  };
  disk: { radiativeEfficiency: number };
  darkMatter: { contribution: number };
}

const FN_URL = AI_FN_BASE ? `${AI_FN_BASE}/blackhole-physics` : null;

export function usePhysicsBackend(params: BlackHoleParams, debounceMs = 600) {
  const [data, setData] = useState<PhysicsReadout | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Only re-fetch when physically meaningful params change.
  const key = `${params.mass}|${params.spin}|${params.diskInner}|${params.diskOuter}|${params.darkMatter}|${params.haloScale}`;

  useEffect(() => {
    if (!FN_URL) {
      setError("Backend not configured");
      return;
    }
    const handle = window.setTimeout(async () => {
      setLoading(true);
      try {
        const resp = await fetch(FN_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(AI_PUB_KEY ? { Authorization: `Bearer ${AI_PUB_KEY}` } : {}),
          },
          body: JSON.stringify({
            mass: params.mass,
            spin: params.spin,
            diskInner: params.diskInner,
            diskOuter: params.diskOuter,
            darkMatter: params.darkMatter,
            haloScale: params.haloScale,
          }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = (await resp.json()) as PhysicsReadout;
        setData(json);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error");
      } finally {
        setLoading(false);
      }
    }, debounceMs);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, debounceMs]);

  return { data, error, loading };
}
