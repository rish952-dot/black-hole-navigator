import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, ChromaticAberration, ToneMapping } from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";
import * as THREE from "three";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useIsMobile } from "@/hooks/use-mobile";
import { NodeInspectorPanel, type NodeState, type NodeFieldReadout, type LayerToggles } from "./views/NodeInspectorPanel";
import { MeshTopographyLayer, type TopoField, type NodeInfluence } from "./MeshTopographyLayer";
import { useAdaptiveLOD } from "./useAdaptiveLOD";
import { TopoControlPanel, DEFAULT_TOPO_CONTROLS, type TopoControls } from "./views/TopoControlPanel";
import { useAINodes, type AIDirective, type AIDirectiveAction } from "./useAINodes";
import { AIActivityPanel, emptyStat, type AINodeStat } from "./views/AIActivityPanel";
import { useAIStream, useSelfHealing, clampDirective, DEFAULT_ACTION_CAPS, type ActionCaps, type DebugEvent, type StreamProvider } from "./useAIStream";
import { AIActionCapsPanel } from "./views/AIActionCapsPanel";
import { AIDebugPanel } from "./views/AIDebugPanel";

const CORE_AI_NODE_COUNT = 6;
const GOVERNOR_AI_NODE_COUNT = 65;
const AI_NODE_COUNT = CORE_AI_NODE_COUNT + GOVERNOR_AI_NODE_COUNT;

interface Props {
  className?: string;
  nodeCount?: number;
  errorRate?: number;
}

export function NeuralTapestry({ className, nodeCount, errorRate = 0.003 }: Props) {
  const isMobile = useIsMobile();
  const count = nodeCount ?? (isMobile ? 3500 : 30000);
  const lod = useAdaptiveLOD({ initialTier: isMobile ? "med" : "high" });
  const [focusOn, setFocusOn] = useState<[number, number, number] | null>(null);
  const [errorInfo, setErrorInfo] = useState<{ total: number; broken: number; firstIdx: number | null }>({ total: 0, broken: 0, firstIdx: null });
  const [selected, setSelected] = useState<NodeState | null>(null);
  const [field, setField] = useState<NodeFieldReadout | null>(null);
  const stateMap = useRef<Map<number, NodeState>>(new Map());
  const [, forceTick] = useState(0);
  const bumpVisuals = useCallback(() => forceTick((n) => n + 1), []);
  const [layers, setLayers] = useState<LayerToggles>({ mesh: true, fourD: true, debug: false });
  const [hit, setHit] = useState<{ instanceId: number; point: [number, number, number]; distance: number; screen: [number, number]; timestamp: number } | null>(null);
  const [influences, setInfluences] = useState<NodeInfluence[]>([]);
  const [topoCtl, setTopoCtl] = useState<TopoControls>(DEFAULT_TOPO_CONTROLS);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiDirectives, setAiDirectives] = useState<AIDirective[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);
  const [actionCaps, setActionCaps] = useState<ActionCaps>(DEFAULT_ACTION_CAPS);
  const [overclock, setOverclock] = useState(false);
  const [debugProvider, setDebugProvider] = useState<StreamProvider>("default");
  const [debugEvents, setDebugEvents] = useState<DebugEvent[]>([]);
  const handleDebugEvent = useCallback((e: DebugEvent) => setDebugEvents((prev) => [e, ...prev].slice(0, 100)), []);
  const [aiStats, setAiStats] = useState<AINodeStat[]>(() => Array.from({ length: AI_NODE_COUNT }, (_, i) => emptyStat(i, i >= CORE_AI_NODE_COUNT)));
  const impulseMap = useRef<Map<number, { expires: number; amp: number }>>(new Map());
  const cameraShakeRef = useRef<{ until: number; amp: number }>({ until: 0, amp: 0 });
  const capsRef = useRef(actionCaps);
  capsRef.current = actionCaps;
  const overclockRef = useRef(overclock);
  overclockRef.current = overclock;
  const snapshotRef = useRef({ curvature: 0.5, energyDensity: 0.5, stability: 1, flowAngle: 0, anomalies: 0, fps: 60, brokenEdges: 0, totalNodes: count });

  const handleSelect = useCallback((idx: number, readout: NodeFieldReadout) => {
    const existing = stateMap.current.get(idx);
    const next: NodeState = existing ?? { index: idx, frozen: false, isolated: false, boost: 0 };
    stateMap.current.set(idx, next);
    setSelected({ ...next });
    setField(readout);
    setFocusOn(readout.pos);
  }, []);

  const mutateSelected = useCallback((mut: (n: NodeState) => NodeState) => {
    if (!selected) return;
    const next = mut({ ...stateMap.current.get(selected.index)! });
    stateMap.current.set(selected.index, next);
    setSelected({ ...next });
    bumpVisuals();
  }, [selected, bumpVisuals]);

  const topoField: TopoField = useMemo(() => {
    let boostSum = 0;
    let isolatedCount = 0;
    let frozenCount = 0;
    let influenced = 0;
    stateMap.current.forEach((s) => {
      if (s.boost !== 0) { boostSum += s.boost; influenced++; }
      if (s.isolated) isolatedCount++;
      if (s.frozen) frozenCount++;
    });
    const baseEnergy = Math.min(1.5, 0.4 + Math.abs(boostSum) * 0.3 + influenced * 0.05);
    const baseStability = Math.max(0, 1 - (isolatedCount * 0.08 + errorInfo.broken * 0.05));
    const baseCurvature = selected ? 1.0 + (selected.boost * 0.4 || 0) : 0.5;
    const baseFlowAngle = (frozenCount * 0.7) % (Math.PI * 2);
    const anomalies = Math.min(6, errorInfo.broken);
    const k = topoCtl.intensity;
    return { curvature: baseCurvature * topoCtl.curvature * k, energyDensity: baseEnergy * topoCtl.energy * k, stability: Math.max(0, Math.min(1, baseStability * topoCtl.stability)), flowAngle: (baseFlowAngle + topoCtl.flowAngle) % (Math.PI * 2), anomalies };
  }, [selected, errorInfo, topoCtl]);

  useEffect(() => {
    snapshotRef.current = { curvature: topoField.curvature, energyDensity: topoField.energyDensity, stability: topoField.stability, flowAngle: topoField.flowAngle, anomalies: topoField.anomalies, fps: lod.fps, brokenEdges: errorInfo.broken, totalNodes: count };
  }, [topoField, lod.fps, errorInfo.broken, count]);

  const applyDirectives = useCallback((directives: AIDirective[]) => {
    const caps = capsRef.current;
    const oc = overclockRef.current;
    const clamped: AIDirective[] = [];
    for (const d of directives) {
      const cd = oc ? d : clampDirective(d, caps);
      if (cd) clamped.push(cd);
    }
    if (clamped.length === 0) return;
    setAiDirectives(clamped);
    setAiError(null);
    const ts = Date.now();
    setAiStats((prev) => {
      const nextStats = prev.slice();
      clamped.forEach((d) => {
        const nodeId = Math.max(0, Math.min(AI_NODE_COUNT - 1, d.nodeId));
        const cur = nextStats[nodeId];
        const action: AIDirectiveAction = d.action;
        nextStats[nodeId] = { ...cur, total: cur.total + 1, counts: { ...cur.counts, [action]: cur.counts[action] + 1 }, intensitySum: cur.intensitySum + d.intensity, intensityAbsSum: cur.intensityAbsSum + Math.abs(d.intensity), lastAction: action, lastIntensity: d.intensity, lastReason: d.reason, lastTs: ts };
      });
      return nextStats;
    });
    let maxImpulse = 0;
    clamped.forEach((d) => {
      const nodeId = Math.max(0, Math.min(AI_NODE_COUNT - 1, d.nodeId));
      const idx = count + nodeId;
      const cur = stateMap.current.get(idx) ?? { index: idx, frozen: false, isolated: false, boost: 0 };
      const next: NodeState = { ...cur };
      switch (d.action) {
        case "boost": next.boost = d.intensity; next.frozen = false; break;
        case "freeze": next.frozen = true; break;
        case "isolate": next.isolated = true; break;
        case "release": next.frozen = false; next.isolated = false; next.boost = 0; break;
        case "anomaly": next.boost = Math.max(next.boost, 0.6); next.isolated = true; break;
      }
      stateMap.current.set(idx, next);
      const amp = d.action === "anomaly" ? 0.9 : Math.abs(d.intensity) > 0.4 ? Math.abs(d.intensity) : 0;
      if (amp > 0) { impulseMap.current.set(idx, { expires: ts + 380, amp }); if (amp > maxImpulse) maxImpulse = amp; }
    });
    if (maxImpulse > 0.7) { const dur = maxImpulse > 0.9 ? 260 : 160; cameraShakeRef.current = { until: ts + dur, amp: Math.min(0.08, (maxImpulse - 0.7) * 0.18) }; }
    bumpVisuals();
  }, [count, bumpVisuals]);

  const getSnapshot = useCallback(() => snapshotRef.current, []);
  const { requestCount: aiReqCount, lastError: aiHookError } = useAINodes({ intervalMs: 30000, disabled: !aiEnabled, getSnapshot, onDirectives: applyDirectives });
  useEffect(() => { if (aiHookError) setAiError(aiHookError); }, [aiHookError]);
  const onStreamDirective = useCallback((d: AIDirective) => applyDirectives([d]), [applyDirectives]);
  const { status: streamStatus, error: streamError, streamCount, directiveCount: streamDirCount, lastLatencyMs: streamLatency, reconnect: reconnectStream } = useAIStream({ disabled: !aiEnabled, getSnapshot, onDirective: onStreamDirective, provider: debugProvider, overclock, onDebugEvent: handleDebugEvent });
  const healActions = useMemo(() => ({
    releaseAllAI: () => { for (let i = 0; i < AI_NODE_COUNT; i++) stateMap.current.set(count + i, { index: count + i, frozen: false, isolated: false, boost: 0 }); bumpVisuals(); },
    repairBrokenEdges: () => setErrorInfo((e) => ({ ...e, broken: 0, firstIdx: null })),
    pulseRandomBoosts: (intensity: number) => { const ts = Date.now(); for (let k = 0; k < 6; k++) { const nodeId = Math.floor(Math.random() * AI_NODE_COUNT); const idx = count + nodeId; const sign = Math.random() < 0.5 ? -1 : 1; const v = sign * intensity * (0.6 + Math.random() * 0.4); stateMap.current.set(idx, { index: idx, frozen: false, isolated: false, boost: v }); impulseMap.current.set(idx, { expires: ts + 350, amp: Math.abs(v) }); } bumpVisuals(); },
  }), [count, bumpVisuals]);
  const readHealing = useCallback(() => {
    let isolatedAI = 0;
    for (let i = 0; i < AI_NODE_COUNT; i++) if (stateMap.current.get(count + i)?.isolated) isolatedAI++;
    return { brokenEdges: errorInfo.broken, isolatedAINodes: isolatedAI, stability: snapshotRef.current.stability, lastHealMs: 0, healCount: 0 };
  }, [count, errorInfo.broken]);
  const { healEvents } = useSelfHealing({ enabled: aiEnabled, read: readHealing, actions: healActions });
  useEffect(() => { if (streamError) setAiError(streamError); }, [streamError]);

  return <div className={cn("relative h-full w-full overflow-hidden rounded-lg border border-border bg-black", className)}>
    <Canvas gl={{ antialias: true, powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.15 }} dpr={[1, isMobile ? 1.2 : 1.6]} camera={{ position: [0, 0, 50], fov: 50 }}>
      <color attach="background" args={["#020410"]} />
      <ambientLight intensity={0.6} />
      {layers.fourD && topoCtl.enabled && <MeshTopographyLayer field={topoField} influences={influences} resolution={lod.topoResolution} updateInterval={lod.topoUpdateInterval} wireframe={layers.debug} />}
      <TapestryMesh count={count} coreAiCount={CORE_AI_NODE_COUNT} governorAiCount={GOVERNOR_AI_NODE_COUNT} errorRate={errorRate} onError={setErrorInfo} onFocusRequest={setFocusOn} onSelect={handleSelect} onHit={layers.debug ? setHit : undefined} onInfluences={setInfluences} stateMap={stateMap.current} selectedIdx={selected?.index ?? null} layers={layers} impulseMap={impulseMap.current} />
      <CameraRig focusOn={focusOn} shakeRef={cameraShakeRef} />
      <OrbitControls enableDamping dampingFactor={0.08} minDistance={10} maxDistance={200} touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }} />
      {!lod.reduced && <EffectComposer multisampling={isMobile ? 0 : 2}><Bloom intensity={isMobile ? 0.5 : 0.9} luminanceThreshold={0.35} luminanceSmoothing={0.4} mipmapBlur /><ChromaticAberration offset={new THREE.Vector2(0.0008, 0.0012)} radialModulation={false} modulationOffset={0} blendFunction={BlendFunction.NORMAL} /><Vignette eskil={false} offset={0.25} darkness={0.85} /><ToneMapping mode={ToneMappingMode.ACES_FILMIC} /></EffectComposer>}
    </Canvas>
    <div className="pointer-events-none absolute left-3 top-3 space-y-1">
      <div className="rounded border border-secondary/40 bg-black/60 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-secondary">Tapestry · {count.toLocaleString()} params</div>
      <div className="rounded border border-border bg-black/60 px-2 py-1 font-mono text-[10px] text-muted-foreground">edges {errorInfo.total.toLocaleString()} · <span className="text-destructive">broken {errorInfo.broken}</span></div>
    </div>
  </div>;
}
