import { useCallback, useEffect, useRef, useState } from "react";
import { BACKEND_CONFIGURED, callFunction } from "@/lib/backend";

export interface HealthPayload {
  ok: boolean;
  version: string;
  ts: number;
  services: {
    database: { ok: boolean; latencyMs: number; error: string | null };
    ai: { configured: boolean };
    finance: { realMoneyEnabled: boolean; allowedModes: string[] };
  };
}

export type BackendStatus = "checking" | "online" | "degraded" | "offline" | "unconfigured";

export interface BackendHealth {
  status: BackendStatus;
  payload: HealthPayload | null;
  error: string | null;
  latencyMs: number | null;
  lastChecked: number | null;
  refresh: () => void;
}

/** Polls the deployment health endpoint; never throws, degrades to "offline". */
export function useBackendHealth(intervalMs = 60000): BackendHealth {
  const [status, setStatus] = useState<BackendStatus>(BACKEND_CONFIGURED ? "checking" : "unconfigured");
  const [payload, setPayload] = useState<HealthPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);
  const mounted = useRef(true);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!BACKEND_CONFIGURED) {
      setStatus("unconfigured");
      return;
    }
    let cancelled = false;

    const check = async () => {
      const t0 = Date.now();
      const res = await callFunction<HealthPayload>("health", undefined, { timeoutMs: 8000 });
      if (cancelled || !mounted.current) return;
      setLatencyMs(Date.now() - t0);
      setLastChecked(Date.now());
      if (res.ok) {
        setPayload(res.data);
        setError(res.data.services?.database?.error ?? null);
        setStatus(res.data.ok ? "online" : "degraded");
      } else {
        setError(res.error);
        setStatus("offline");
      }
    };

    check();
    const id = window.setInterval(check, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [intervalMs, nonce]);

  return { status, payload, error, latencyMs, lastChecked, refresh };
}
