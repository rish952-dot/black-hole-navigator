import { useEffect, useRef, useState, useCallback } from "react";
import { AI_FN_BASE, AI_PUB_KEY, type AIDirective, type AIDirectiveAction, type AIFieldSnapshot } from "./useAINodes";

/**
 * useAIStream — long-lived SSE to ai-node-stream edge function.
 *
 * Adds:
 *   - `provider`: "default" (Lovable AI) or "debug" (external API key)
 *   - `overclock`: bumps requested directive count and tightens cooldown
 *   - `onDebugEvent`: opaque tap that mirrors every parsed SSE frame so the
 *     AI Debug Panel can render a raw event log without re-parsing.
 */
export type StreamProvider = "default" | "debug";

export interface DebugEvent {
  ts: number;
  kind: "open" | "directive" | "error" | "done" | "http" | "reconnect";
  payload: unknown;
}

interface StreamOptions {
  disabled?: boolean;
  getSnapshot: () => AIFieldSnapshot;
  onDirective: (d: AIDirective) => void;
  cooldownMs?: number;
  backoffMs?: number;
  provider?: StreamProvider;
  overclock?: boolean;
  onDebugEvent?: (e: DebugEvent) => void;
}

const FN_URL = AI_FN_BASE ? `${AI_FN_BASE}/ai-node-stream` : null;

export function useAIStream({
  disabled,
  getSnapshot,
  onDirective,
  cooldownMs = 1500,
  backoffMs = 15000,
  provider = "default",
  overclock = false,
  onDebugEvent,
}: StreamOptions) {
  const [status, setStatus] = useState<"idle" | "connecting" | "open" | "error" | "stopped">("idle");
  const [error, setError] = useState<string | null>(null);
  const [streamCount, setStreamCount] = useState(0);
  const [directiveCount, setDirectiveCount] = useState(0);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);

  // Bumping this triggers the connect effect to tear down + reconnect.
  const [reconnectNonce, setReconnectNonce] = useState(0);

  const stoppedRef = useRef(false);
  const onDirectiveRef = useRef(onDirective);
  onDirectiveRef.current = onDirective;
  const getSnapshotRef = useRef(getSnapshot);
  getSnapshotRef.current = getSnapshot;
  const onDebugRef = useRef(onDebugEvent);
  onDebugRef.current = onDebugEvent;

  const emit = useCallback((kind: DebugEvent["kind"], payload: unknown) => {
    onDebugRef.current?.({ ts: Date.now(), kind, payload });
  }, []);

  // Effective cooldown is shorter in overclock mode.
  const effCooldown = overclock ? 0 : cooldownMs;

  useEffect(() => {
    if (disabled) return;
    if (!FN_URL) {
      setStatus("error");
      setError("Stream disabled (Cloud not configured)");
      // Soft auto-retry every 10s in case cloud comes online (e.g. user
      // enables Lovable Cloud without reloading). The bump triggers re-run.
      const t = window.setInterval(() => setReconnectNonce((n) => n + 1), 10000);
      return () => clearInterval(t);
    }

    stoppedRef.current = false;
    let abortController: AbortController | null = null;
    let reconnectTimer: number | null = null;
    let attempt = 0;

    const runOnce = async () => {
      if (stoppedRef.current) return;
      setStatus("connecting");
      abortController = new AbortController();
      const t0 = performance.now();
      try {
        const snap = getSnapshotRef.current();
        const resp = await fetch(FN_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(AI_PUB_KEY ? { Authorization: `Bearer ${AI_PUB_KEY}` } : {}),
          },
          body: JSON.stringify({ ...snap, provider, overclock }),
          signal: abortController.signal,
        });

        emit("http", { status: resp.status, provider, overclock });

        if (resp.status === 402) {
          setError("AI credits exhausted — stream stopped");
          setStatus("stopped");
          stoppedRef.current = true;
          return;
        }
        if (resp.status === 429) {
          setError("Rate limited — stream stopped (use ↻ reconnect)");
          setStatus("stopped");
          stoppedRef.current = true;
          return;
        }
        if (!resp.ok || !resp.body) {
          throw new Error(`HTTP ${resp.status}`);
        }

        attempt = 0;
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
                setLastLatencyMs(performance.now() - t0);
                emit("open", evt);
              } else if (evt.type === "directive" && evt.directive) {
                onDirectiveRef.current(evt.directive as AIDirective);
                setDirectiveCount((n) => n + 1);
                emit("directive", evt.directive);
              } else if (evt.type === "error") {
                setError(String(evt.message ?? "stream error"));
                emit("error", evt);
              } else if (evt.type === "done") {
                emit("done", evt);
              }
            } catch {
              /* malformed frame */
            }
          }
        }

        if (!stoppedRef.current) {
          emit("reconnect", { afterMs: effCooldown });
          reconnectTimer = window.setTimeout(runOnce, effCooldown);
        }
      } catch (e) {
        if (stoppedRef.current) return;
        attempt++;
        const wait = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
        setStatus("error");
        const msg = e instanceof Error ? e.message : "Network error";
        setError(msg);
        emit("error", { message: msg });
        reconnectTimer = window.setTimeout(runOnce, wait);
      }
    };

    runOnce();

    return () => {
      stoppedRef.current = true;
      abortController?.abort();
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    };
  }, [disabled, effCooldown, backoffMs, provider, overclock, emit, reconnectNonce]);

  // Manual reconnect — clears any "stopped" latch (e.g. 402 credits exhausted)
  // and forces the connect effect to re-run from scratch.
  const reconnect = useCallback(() => {
    stoppedRef.current = false;
    setError(null);
    setStatus("connecting");
    emit("reconnect", { afterMs: 0, manual: true });
    setReconnectNonce((n) => n + 1);
  }, [emit]);

  return { status, error, streamCount, directiveCount, lastLatencyMs, reconnect };
}

// ---------------------------------------------------------------------------
// Per-action intensity caps
// ---------------------------------------------------------------------------

export type ActionCaps = Record<AIDirectiveAction, number>;

export const DEFAULT_ACTION_CAPS: ActionCaps = {
  boost: 1,
  freeze: 1,
  isolate: 1,
  release: 1,
  anomaly: 1,
};

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
  releaseAllAI: () => void;
  repairBrokenEdges: () => void;
  pulseRandomBoosts: (intensity: number) => void;
}

interface HealOptions {
  enabled: boolean;
  stabilityThreshold?: number;
  cooldownMs?: number;
  read: () => HealingState;
  actions: HealingActions;
}

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
