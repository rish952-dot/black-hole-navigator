import { callFunction, type FnResult } from "@/lib/backend";
import type { ControllerState } from "./controller";
import { enforceMode } from "./finance";
import type { FarmConfig } from "./types";

/**
 * Deterministic run persistence. All writes go through the `farm-state`
 * function (service-role only tables). Failures are returned, never thrown:
 * the farm keeps running locally when the backend is unavailable.
 */
const RUN_KEY_STORAGE = "farm.runKey";

export function getRunKey(): string {
  try {
    const existing = localStorage.getItem(RUN_KEY_STORAGE);
    if (existing && /^[A-Za-z0-9_-]{6,64}$/.test(existing)) return existing;
  } catch {
    /* storage blocked — fall through to an ephemeral key */
  }
  const key = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    localStorage.setItem(RUN_KEY_STORAGE, key);
  } catch {
    /* ignore */
  }
  return key;
}

export interface SavePayload {
  action: "save";
  runKey: string;
  seed: number;
  mode: string;
  generation: number;
  halted: string | null;
  config: Record<string, unknown>;
  totals: Record<string, number>;
  health: Record<string, unknown> | null;
  generations: { index: number; record: Record<string, unknown>; metrics: Record<string, unknown> | null }[];
  ledger: { agentId: string; generation: number; type: string; amount: number; description: string; ts: number }[];
}

export const MAX_GENERATIONS_PER_SAVE = 200;
export const MAX_LEDGER_PER_SAVE = 500;

export function buildSavePayload(runKey: string, cfg: FarmConfig, state: ControllerState): SavePayload {
  const { snapshot, metricsHistory, health } = state;
  const metricByGen = new Map(metricsHistory.map((m) => [m.generation, m as unknown as Record<string, unknown>]));
  const gens = snapshot.generations.slice(-MAX_GENERATIONS_PER_SAVE).map((g) => ({
    index: g.index,
    record: g as unknown as Record<string, unknown>,
    metrics: metricByGen.get(g.index) ?? null,
  }));

  return {
    action: "save",
    runKey,
    seed: cfg.seed,
    mode: enforceMode(cfg.mode).mode,
    generation: snapshot.generation,
    halted: snapshot.halted,
    config: cfg as unknown as Record<string, unknown>,
    totals: snapshot.totals,
    health: (health as unknown as Record<string, unknown>) ?? null,
    generations: gens,
    ledger: snapshot.transactions.slice(0, MAX_LEDGER_PER_SAVE).map((t) => ({
      agentId: t.agentId,
      generation: t.generation,
      type: t.type,
      amount: t.amount,
      description: t.description,
      ts: t.ts,
    })),
  };
}

export interface SaveResponse {
  ok: boolean;
  runKey: string;
  savedGenerations: number;
  savedLedger: number;
  ts: number;
}

export interface LoadResponse {
  found: boolean;
  run?: {
    run_key: string;
    seed: number;
    mode: string;
    generation: number;
    halted: string | null;
    config: FarmConfig;
    totals: Record<string, number>;
    updated_at: string;
  };
  generations?: { index: number; record: Record<string, unknown>; metrics: Record<string, unknown> | null }[];
  ledger?: Record<string, unknown>[];
}

export function saveRun(payload: SavePayload): Promise<FnResult<SaveResponse>> {
  return callFunction<SaveResponse>("farm-state", payload, { timeoutMs: 15000 });
}

export function loadRun(runKey: string): Promise<FnResult<LoadResponse>> {
  return callFunction<LoadResponse>("farm-state", { action: "load", runKey }, { timeoutMs: 15000 });
}
