import { useEffect, useRef, useState, useCallback } from "react";
import { AI_FN_BASE, AI_PUB_KEY, type AIDirective, type AIDirectiveAction, type AIFieldSnapshot } from "./useAINodes";

/**
 * useAIStream — opens a long-lived SSE connection to the ai-node-stream edge
 * function. The function streams individual directives as fast as the model
 * produces them; we forward each one to `onDirective`.
 *
 * Reconnect strategy:
 *   - When the upstream emits {type:"done"}, we wait `cooldownMs` and reopen
 *     with a fresh snapshot.
 *   - On 402 (credits) we permanently stop and surface the error.
 *   - On 429 (rate limit) we back off for `backoffMs` then retry.
 *   - On any other error we retry with exponential backoff (capped at 30s).
 */
interface StreamOptions {
  disabled?: boolean;
  getSnapshot: () => AIFieldSnapshot;
  onDirective: (d: AIDirective) => void;
  cooldownMs?: number;   // gap between successful sessions (default 1500)
  backoffMs?: number;    // backoff after 429 (default 15000)
}

const FN_URL = AI_FN_BASE ? `${AI_FN_BASE}/ai-node-stream` : null;

export function useAIStream({
  disabled,
  getSnapshot,
  onDirective,
  cooldownMs = 1500,
  backoffMs = 15000,
}: StreamOptions) {
  const [status, setStatus] = useState<"idle" | "connecting" | "open" | "error" | "stopped">("idle");
  const [error, setError] = useState<string | null>(null);
  const [streamCount, setStreamCount] = useState(0);
  const [directiveCount, setDirectiveCount] = useState(0);
  const stoppedRef = useRef(false);
  const onDirectiveRef = useRef(onDirective);
  onDirectiveRef.current = onDirective;
  const getSnapshotRef = useRef(getSnapshot);
  getSnapshotRef.current = getSnapshot;

  useEffect(() => {
    if (disabled) return;
    if (!FN_URL) {
      setStatus("error");
      setError("Stream disabled (Cloud not configured)");
      return;
    }

    stoppedRef.current = false;
    let abortController: AbortController | null = null;
    let reconnectTimer: number | null = null;
    let attempt = 0;

    const runOnce = async () => {
      if (stoppedRef.current) return;
      setStatus("connecting");
      abortController = new AbortController();
      try {
        const resp = await fetch(FN_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(AI_PUB_KEY ? { Authorization: `Bearer ${AI_PUB_KEY}` } : {}),
          },
          body: JSON.stringify(getSnapshotRef.current()),
          signal: abortController.signal,
        });

        if (resp.status === 402) {
          setError("AI credits exhausted — stream stopped");
          setStatus("stopped");
          stoppedRef.current = true;
          return;
        }
        if (resp.status === 429) {
          setError("Rate limited — backing off");
          setStatus("error");
          reconnectTimer = window.setTimeout(runOnce, backoffMs);
          return;
        }
        if (!resp.ok || !resp.body) {
          throw new Error(`HTTP ${resp.status}`);
        }

        attempt = 0; // reset backoff on a successful open
        setStreamCount((n) => n + 1);

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (!stoppedRef.current) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          let nl: number;
          while ((nl = buf.indexOf("\n\n")) !== -1) {
            const frame = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 2);
            if (!frame.startsWith("data: ")) continue;
            const json = frame.slice(6).trim();
            if (!json) continue;
            try {
              const evt = JSON.parse(json);
              if (evt.type === "open") {
                setStatus("open");
                setError(null);
              } else if (evt.type === "directive" && evt.directive) {
                onDirectiveRef.current(evt.directive as AIDirective);
                setDirectiveCount((n) => n + 1);
              } else if (evt.type === "error") {
                setError(String(evt.message ?? "stream error"));
              }
              // {type:"done"} → loop will exit naturally on next reader.read()
            } catch {
              /* swallow malformed frames */
            }
          }
        }

        // Successful end-of-stream → cool down then reconnect with fresh snapshot.
        if (!stoppedRef.current) {
          reconnectTimer = window.setTimeout(runOnce, cooldownMs);
        }
      } catch (e) {
        if (stoppedRef.current) return;
        attempt++;
        const wait = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
        setStatus("error");
        setError(e instanceof Error ? e.message : "Network error");
        reconnectTimer = window.setTimeout(runOnce, wait);
      }
    };

    runOnce();

    return () => {
      stoppedRef.current = true;
      abortController?.abort();
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    };
  }, [disabled, cooldownMs, backoffMs]);

  return { status, error, streamCount, directiveCount };
}

// ---------------------------------------------------------------------------
// Per-action intensity caps
// ---------------------------------------------------------------------------

/** 0 = action disabled entirely; 1 = no cap. Applied to |intensity|. */
export type ActionCaps = Record<AIDirectiveAction, number>;

export const DEFAULT_ACTION_CAPS: ActionCaps = {
  boost: 1,
  freeze: 1,
  isolate: 1,
  release: 1,
  anomaly: 1,
};

/**
 * Clamp a directive against the user-defined per-action caps.
 *
 *   - If the cap for this action is 0, the directive is dropped (returns null).
 *   - Otherwise intensity is clamped so |intensity| <= cap, preserving sign.
 */
export function clampDirective(d: AIDirective, caps: ActionCaps): AIDirective | null {
  const cap = caps[d.action];
  if (cap <= 0) return null;
  if (cap >= 1) return d;
  const sign = d.intensity < 0 ? -1 : 1;
  const mag = Math.min(Math.abs(d.intensity), cap);
  return { ...d, intensity: sign * mag };
}

// ---------------------------------------------------------------------------
// Self-healing governor
// ---------------------------------------------------------------------------

export interface HealingState {
  brokenEdges: number;
  isolatedAINodes: number;
  stability: number;
  lastHealMs: number;
  healCount: number;
}

export interface HealingActions {
  /** Release all isolated/frozen AI nodes and zero their boost. */
  releaseAllAI: () => void;
  /** Mark broken edges as repaired (visual). */
  repairBrokenEdges: () => void;
  /** Apply a soft, randomized boost across the AI ring to inject motion. */
  pulseRandomBoosts: (intensity: number) => void;
}

interface HealOptions {
  enabled: boolean;
  /** Trigger heal when stability drops below this (0..1). Default 0.25. */
  stabilityThreshold?: number;
  /** Minimum gap between heal cycles, ms. Default 4000. */
  cooldownMs?: number;
  /** Source of current readings — called on every tick. */
  read: () => HealingState;
  actions: HealingActions;
}

/**
 * useSelfHealing — runs a 500ms heartbeat that watches stability/broken-edge
 * counts and, when both are critical, dispatches release + repair + a small
 * randomized motion pulse so the field visibly recovers without waiting on
 * the AI poll/stream loop.
 */
export function useSelfHealing({
  enabled,
  stabilityThreshold = 0.25,
  cooldownMs = 4000,
  read,
  actions,
}: HealOptions) {
  const lastHealRef = useRef(0);
  const readRef = useRef(read);
  const actionsRef = useRef(actions);
  readRef.current = read;
  actionsRef.current = actions;
  const [healEvents, setHealEvents] = useState<{ ts: number; reason: string }[]>([]);

  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      const s = readRef.current();
      const now = Date.now();
      if (now - lastHealRef.current < cooldownMs) return;
      const critical =
        s.stability < stabilityThreshold ||
        s.brokenEdges > 50 ||
        s.isolatedAINodes > 5;
      if (!critical) return;
      lastHealRef.current = now;
      const reason =
        s.stability < stabilityThreshold
          ? `stability ${s.stability.toFixed(2)}`
          : s.brokenEdges > 50
          ? `${s.brokenEdges} broken edges`
          : `${s.isolatedAINodes} isolated AI`;
      actionsRef.current.releaseAllAI();
      actionsRef.current.repairBrokenEdges();
      actionsRef.current.pulseRandomBoosts(0.35);
      setHealEvents((h) => [{ ts: now, reason }, ...h].slice(0, 8));
    }, 500);
    return () => clearInterval(id);
  }, [enabled, stabilityThreshold, cooldownMs]);

  return { healEvents };
}
