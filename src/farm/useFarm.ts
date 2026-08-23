import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FarmEngine, type FarmSnapshot } from "./engine";
import { getMeshField, subscribeMeshField } from "./meshBridge";
import { DEFAULT_CONFIG, NEUTRAL_MESH, type FarmConfig, type MeshField } from "./types";

export function useFarm(initial: FarmConfig = DEFAULT_CONFIG) {
  const engineRef = useRef<FarmEngine | null>(null);
  if (!engineRef.current) engineRef.current = new FarmEngine(initial);
  const engine = engineRef.current;

  const [config, setConfig] = useState<FarmConfig>(initial);
  const [snapshot, setSnapshot] = useState<FarmSnapshot>(() => engine.snapshot());
  const [running, setRunning] = useState(false);
  const [speedMs, setSpeedMs] = useState(700);
  const [field, setField] = useState<MeshField>(() => getMeshField() ?? NEUTRAL_MESH);

  useEffect(() => subscribeMeshField(setField), []);

  const step = useCallback(() => {
    engine.cfg = { ...engine.cfg, ...config };
    engine.step(config.meshCoupling ? getMeshField() : NEUTRAL_MESH);
    setSnapshot(engine.snapshot());
  }, [engine, config]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      step();
      if (engine.halted) setRunning(false);
    }, speedMs);
    return () => window.clearInterval(id);
  }, [running, speedMs, step, engine]);

  const reset = useCallback(
    (cfg: FarmConfig = config) => {
      setRunning(false);
      engine.reset(cfg);
      setConfig(cfg);
      setSnapshot(engine.snapshot());
    },
    [engine, config],
  );

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

  return { engine, config, setConfig, snapshot, running, setRunning, speedMs, setSpeedMs, step, reset, lineages, field };
}
