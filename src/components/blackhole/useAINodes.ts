import { useEffect, useRef, useState } from "react";

/**
 * AI Node tick hook.
 *
 * Six dedicated AI nodes embedded in the NeuralTapestry ping the
 * `ai-node-tick` edge function every ~3 seconds with a snapshot of the
 * current field state. The model returns 6 directives — one per node —
 * which the caller applies to its `stateMap` to steer the simulation.
 *
 * Design notes:
 *   - One in-flight request at a time (skip tick if previous still pending).
 *   - On 402/429 we back off to 15s for one cycle, then resume.
 *   - The snapshot is captured via a ref so the interval doesn't re-bind
 *     when field values change; we always send the latest at fire time.
 */

export type AIDirectiveAction = "boost" | "freeze" | "isolate" | "release" | "anomaly";

export interface AIDirective {
  nodeId: number;       // 0..5
  action: AIDirectiveAction;
  intensity: number;    // -1..1
  reason: string;
}

export interface AIFieldSnapshot {
  curvature: number;
  energyDensity: number;
  stability: number;
  flowAngle: number;
  anomalies: number;
  fps: number;
  brokenEdges: number;
  totalNodes: number;
}

interface Options {
  /** Poll interval in ms (default 3000). */
  intervalMs?: number;
  /** Disable polling entirely (e.g., user toggled AI off). */
  disabled?: boolean;
  /** Called with the latest snapshot — must return current values. */
  getSnapshot: () => AIFieldSnapshot;
  /** Called whenever a fresh batch of directives arrives. */
  onDirectives: (d: AIDirective[]) => void;
}

/**
 * Build the edge function base URL. Lovable Cloud sets VITE_SUPABASE_PROJECT_ID;
 * older projects may have VITE_SUPABASE_URL. We prefer URL when present.
 */
function buildFnBase(): string | null {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "");
  if (url && url !== "undefined") return `${url}/functions/v1`;
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined;
  if (projectId && projectId !== "undefined") {
    return `https://${projectId}.supabase.co/functions/v1`;
  }
  return null;
}

const FN_BASE = buildFnBase();
const FN_URL = FN_BASE ? `${FN_BASE}/ai-node-tick` : null;
const PUB_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export function useAINodes({ intervalMs = 3000, disabled, getSnapshot, onDirectives }: Options) {
  const [lastDirectives, setLastDirectives] = useState<AIDirective[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastTick, setLastTick] = useState<number>(0);
  const [requestCount, setRequestCount] = useState(0);

  const inFlightRef = useRef(false);
  const backoffUntilRef = useRef(0);

  useEffect(() => {
    if (disabled) return;
    let cancelled = false;

    const fire = async () => {
      if (inFlightRef.current) return;
      if (Date.now() < backoffUntilRef.current) return;
      inFlightRef.current = true;
      try {
        const snapshot = getSnapshot();
        const resp = await fetch(FN_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(PUB_KEY ? { Authorization: `Bearer ${PUB_KEY}` } : {}),
          },
          body: JSON.stringify(snapshot),
        });

        if (resp.status === 402 || resp.status === 429) {
          backoffUntilRef.current = Date.now() + 15000;
          setLastError(resp.status === 402 ? "AI credits exhausted" : "Rate limited — backing off");
          return;
        }

        const data = await resp.json();
        if (cancelled) return;

        const directives: AIDirective[] = Array.isArray(data.directives) ? data.directives : [];
        if (directives.length > 0) {
          setLastDirectives(directives);
          onDirectives(directives);
          setLastError(null);
        } else if (data.error) {
          setLastError(String(data.error));
        }
        setLastTick(Date.now());
        setRequestCount((n) => n + 1);
      } catch (e) {
        if (!cancelled) setLastError(e instanceof Error ? e.message : "Network error");
      } finally {
        inFlightRef.current = false;
      }
    };

    // Fire immediately on mount, then on the interval.
    fire();
    const id = window.setInterval(fire, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [intervalMs, disabled, getSnapshot, onDirectives]);

  return { lastDirectives, lastError, lastTick, requestCount };
}
