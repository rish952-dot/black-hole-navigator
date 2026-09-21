import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { FarmController, type ControllerState } from "./controller";
import { getMeshField, subscribeMeshField } from "./meshBridge";
import { buildSavePayload, getRunKey, loadRun, saveRun } from "./persistence";
import { DEFAULT_CONFIG, NEUTRAL_MESH, type FarmConfig, type MeshField } from "./types";

export type PersistStatus = "idle" | "saving" | "saved" | "error" | "loading";

const AUTOSAVE_MS = 20000;

export function useFarm(initial: FarmConfig = DEFAULT_CONFIG) {
  const isMobile = useIsMobile();
  const ctrlRef = useRef<FarmController | null>(null);
  if (!ctrlRef.current) ctrlRef.current = new FarmController(initial);
  const controller = ctrlRef.current;
  const engine = controller.engine;

  const [config, setConfig] = useState<FarmConfig>(initial);
  const [state, setState] = useState<ControllerState>(() => controller.state());
  const [running, setRunning] = useState(false);
  const [speedMs, setSpeedMs] = useState(700);
  const [field, setField] = useState<MeshField>(() => getMeshField() ?? NEUTRAL_MESH);
  const [persist, setPersist] = useState<PersistStatus>("idle");
  const [persistError, setPersistError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const runKey = useMemo(() => getRunKey(), []);

  useEffect(() => subscribeMeshField(setField), []);

  // Mobile/low-end budgets: smaller mesh fan-out, shorter metric history.
  useEffect(() => {
    controller.setOptions(
      isMobile ? { maxLinksPerNode: 2, metricsHistoryLimit: 60 } : { maxLinksPerNode: 4, metricsHistoryLimit: 200 },
    );
  }, [controller, isMobile]);

  useEffect(() => {
    if (isMobile) setSpeedMs((s) => Math.max(s, 1200));
  }, [isMobile]);

  const step = useCallback(() => {
    controller.applyConfig(config);
    setState(controller.step(config.meshCoupling ? (getMeshField() ?? NEUTRAL_MESH) : NEUTRAL_MESH));
  }, [controller, config]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      step();
      if (engine.halted) setRunning(false);
    }, speedMs);
    return () => window.clearInterval(id);
  }, [running, speedMs, step, engine]);

  const save = useCallback(async () => {
    setPersist("saving");
    setPersistError(null);
    const res = await saveRun(buildSavePayload(runKey, config, controller.state()));
    if (res.ok) {
      setPersist("saved");
      setLastSaved(Date.now());
    } else {
      setPersist("error");
      setPersistError(res.error);
    }
    return res;
  }, [config, controller, runKey]);

  const restore = useCallback(async () => {
    setPersist("loading");
    setPersistError(null);
    const res = await loadRun(runKey);
    if (!res.ok) {
      setPersist("error");
      setPersistError(res.error);
      return res;
    }
    if (res.data.found && res.data.run?.config) {
      const cfg = { ...DEFAULT_CONFIG, ...res.data.run.config } as FarmConfig;
      setConfig(cfg);
      controller.reset(cfg);
      setState(controller.state());
    }
    setPersist("idle");
    return res;
  }, [controller, runKey]);

  // Throttled autosave while running; failures never interrupt the farm.
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      void save();
    }, AUTOSAVE_MS);
    return () => window.clearInterval(id);
  }, [running, save]);

  const reset = useCallback(
    (cfg: FarmConfig = config) => {
      setRunning(false);
      controller.reset(cfg);
      setConfig(cfg);
      setState(controller.state());
    },
    [controller, config],
  );

  const snapshot = state.snapshot;

  const lineages = useMemo(() => {
    const map = new Map<string, { lineage: string; count: number; bestFitness: number; netProfit: number }>();
    for (const a of snapshot.agents) {
      const e = map.get(a.lineage) ?? { lineage: a.lineage, count: 0, bestFitness: -Infinity, netProfit: 0 };
      e.count++;
      e.bestFitness = Math.max(e.bestFitness, a.stats.fitness);
      e.netProfit += a.stats.netProfit;
      map.set(a.lineage, e);
    }
    return [...map.values()].sort((a, b) => b.bestFitness - a.bestFitness);
  }, [snapshot]);

  return {
    engine,
    controller,
    config,
    setConfig,
    snapshot,
    state,
    running,
    setRunning,
    speedMs,
    setSpeedMs,
    step,
    reset,
    lineages,
    field,
    runKey,
    save,
    restore,
    persist,
    persistError,
    lastSaved,
    isMobile,
  };
}
