import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import {
  EffectComposer,
  Bloom,
  Vignette,
  ChromaticAberration,
  ToneMapping,
} from "@react-three/postprocessing";
import { BlendFunction, ToneMappingMode } from "postprocessing";
import * as THREE from "three";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  NodeInspectorPanel,
  type NodeState,
  type NodeFieldReadout,
  type LayerToggles,
} from "./views/NodeInspectorPanel";
import { MeshTopographyLayer, type TopoField, type NodeInfluence } from "./MeshTopographyLayer";
import { useAdaptiveLOD } from "./useAdaptiveLOD";
import {
  TopoControlPanel,
  DEFAULT_TOPO_CONTROLS,
  type TopoControls,
} from "./views/TopoControlPanel";
import { useAINodes, type AIDirective, type AIDirectiveAction } from "./useAINodes";
import { AIActivityPanel, emptyStat, type AINodeStat } from "./views/AIActivityPanel";
import {
  useAIStream,
  useSelfHealing,
  clampDirective,
  DEFAULT_ACTION_CAPS,
  type ActionCaps,
  type DebugEvent,
  type StreamProvider,
} from "./useAIStream";
import { AIActionCapsPanel } from "./views/AIActionCapsPanel";
import { AIDebugPanel } from "./views/AIDebugPanel";
import { publishMeshField } from "@/farm/meshBridge";

/** Dedicated AI nodes — 6 core actuators + 65 governors that help steer them. */
const CORE_AI_NODE_COUNT = 6;
const GOVERNOR_AI_NODE_COUNT = 65;
const AI_NODE_COUNT = CORE_AI_NODE_COUNT + GOVERNOR_AI_NODE_COUNT; // 71

interface Props {
  className?: string;
  /** override node count; otherwise adaptive (3k mobile, 30k desktop) */
  nodeCount?: number;
  /** percent of broken connections to inject for debug */
  errorRate?: number;
}

/**
 * Neural Parameter Tapestry.
 *
 * A 3D mesh of 3,000+ (mobile) up to 30,000+ (desktop) parameter nodes
 * arranged in a topographic shell, connected by edges that form a small-world
 * neural network. Edges colored normally are plasma cyan; broken / inconsistent
 * connections render BRIGHT RED, and the camera auto-focuses on the first
 * detected anomaly so you can debug visually.
 *
 * Performance: nodes use InstancedMesh; edges use LineSegments with a single
 * BufferGeometry of position + color attributes — one draw call each.
 */
export function NeuralTapestry({
  className,
  nodeCount,
  errorRate = 0.003,
}: Props) {
  const isMobile = useIsMobile();
  // +3000 nodes lift for finer physics resolution. Mobile cap respects perf.
  const count = nodeCount ?? (isMobile ? 7000 : 34000);
  // Mobile boots in "med" tier; desktop in "high". Hook re-evaluates on FPS.
  const lod = useAdaptiveLOD({ initialTier: isMobile ? "med" : "high" });
  const [focusOn, setFocusOn] = useState<[number, number, number] | null>(null);
  const [errorInfo, setErrorInfo] = useState<{
    total: number;
    broken: number;
    firstIdx: number | null;
  }>({ total: 0, broken: 0, firstIdx: null });

  // Per-node selection / control state — light, single-source-of-truth map.
  const [selected, setSelected] = useState<NodeState | null>(null);
  const [field, setField] = useState<NodeFieldReadout | null>(null);
  const stateMap = useRef<Map<number, NodeState>>(new Map());
  const [, forceTick] = useState(0);
  const bumpVisuals = useCallback(() => forceTick((n) => n + 1), []);

  const [layers, setLayers] = useState<LayerToggles>({
    mesh: true,
    fourD: true,
    debug: false,
  });

  // Last raycast hit info — only rendered when debug layer is on.
  const [hit, setHit] = useState<{
    instanceId: number;
    point: [number, number, number];
    distance: number;
    screen: [number, number];
    timestamp: number;
  } | null>(null);

  // Live node-influence list driving the topography layer (GPU uniform).
  const [influences, setInfluences] = useState<NodeInfluence[]>([]);

  // Manual topography overrides — sliders multiply into the derived field.
  const [topoCtl, setTopoCtl] = useState<TopoControls>(DEFAULT_TOPO_CONTROLS);

  // AI control loop — 71 dedicated nodes (6 core + 65 governors) ping every ~3s.
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiDirectives, setAiDirectives] = useState<AIDirective[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);
  // Per-action intensity caps — clamps directive magnitudes; 0 disables an action.
  const [actionCaps, setActionCaps] = useState<ActionCaps>(DEFAULT_ACTION_CAPS);
  // OVERCLOCK — full-send mode: removes caps, denser stream, max impulses.
  const [overclock, setOverclock] = useState(false);
  // AI debug provider + rolling event log (last 100).
  const [debugProvider, setDebugProvider] = useState<StreamProvider>("default");
  const [debugEvents, setDebugEvents] = useState<DebugEvent[]>([]);
  const handleDebugEvent = useCallback((e: DebugEvent) => {
    setDebugEvents((prev) => [e, ...prev].slice(0, 100));
  }, []);
  const [aiStats, setAiStats] = useState<AINodeStat[]>(() =>
    Array.from({ length: AI_NODE_COUNT }, (_, i) =>
      emptyStat(i, i >= CORE_AI_NODE_COUNT),
    ),
  );
  // Per-AI-node impulse pulses — { node absIdx → expiresAt(ms) + amplitude }.
  // Read by the AINodeRing in useFrame to add a brief scale + jitter pop.
  const impulseMap = useRef<Map<number, { expires: number; amp: number }>>(new Map());
  // Camera shake — CameraRig reads { until, amp } and applies a tiny offset.
  const cameraShakeRef = useRef<{ until: number; amp: number }>({ until: 0, amp: 0 });
  // Caps ref so the streaming callback always sees the freshest caps without rebinding.
  const capsRef = useRef(actionCaps);
  capsRef.current = actionCaps;
  const overclockRef = useRef(overclock);
  overclockRef.current = overclock;
  // Latest snapshot ref so the polling loop always sees fresh values.
  const snapshotRef = useRef({
    curvature: 0.5,
    energyDensity: 0.5,
    stability: 1,
    flowAngle: 0,
    anomalies: 0,
    fps: 60,
    brokenEdges: 0,
    totalNodes: count,
  });

  const handleSelect = useCallback(
    (idx: number, readout: NodeFieldReadout) => {
      const existing = stateMap.current.get(idx);
      const next: NodeState = existing ?? {
        index: idx,
        frozen: false,
        isolated: false,
        boost: 0,
      };
      stateMap.current.set(idx, next);
      setSelected({ ...next });
      setField(readout);
      setFocusOn(readout.pos);
    },
    [],
  );

  const mutateSelected = useCallback(
    (mut: (n: NodeState) => NodeState) => {
      if (!selected) return;
      const next = mut({ ...stateMap.current.get(selected.index)! });
      stateMap.current.set(selected.index, next);
      setSelected({ ...next });
      bumpVisuals();
    },
    [selected, bumpVisuals],
  );

  // Derive a live TopoField from existing state. Cheap — runs on render only.
  const topoField: TopoField = useMemo(() => {
    // Aggregate per-node controls (boost, isolation, frozen) into scalar field.
    let boostSum = 0;
    let isolatedCount = 0;
    let frozenCount = 0;
    let influenced = 0;
    stateMap.current.forEach((s) => {
      if (s.boost !== 0) {
        boostSum += s.boost;
        influenced++;
      }
      if (s.isolated) isolatedCount++;
      if (s.frozen) frozenCount++;
    });
    const baseEnergy = Math.min(1.5, 0.4 + Math.abs(boostSum) * 0.3 + influenced * 0.05);
    const baseStability = Math.max(0, 1 - (isolatedCount * 0.08 + errorInfo.broken * 0.05));
    const baseCurvature = selected ? 1.0 + (selected.boost * 0.4 || 0) : 0.5;
    const baseFlowAngle = (frozenCount * 0.7) % (Math.PI * 2);
    const anomalies = Math.min(6, errorInfo.broken);

    // Apply manual controls — multiplicative for magnitudes, additive for angle.
    const k = topoCtl.intensity;
    return {
      curvature: baseCurvature * topoCtl.curvature * k,
      energyDensity: baseEnergy * topoCtl.energy * k,
      // Stability blends the user override toward the derived baseline.
      stability: Math.max(0, Math.min(1, baseStability * topoCtl.stability)),
      flowAngle: (baseFlowAngle + topoCtl.flowAngle) % (Math.PI * 2),
      anomalies,
    };
  }, [selected, errorInfo, topoCtl]);

  // Keep snapshot ref fresh — read by the AI poll loop without re-binding it.
  useEffect(() => {
    snapshotRef.current = {
      curvature: topoField.curvature,
      energyDensity: topoField.energyDensity,
      stability: topoField.stability,
      flowAngle: topoField.flowAngle,
      anomalies: topoField.anomalies,
      fps: lod.fps,
      brokenEdges: errorInfo.broken,
      totalNodes: count,
    };
    // Symbiosis: publish the live field into the Evolutionary Agent Farm.
    publishMeshField({
      curvature: topoField.curvature,
      energyDensity: topoField.energyDensity,
      stability: topoField.stability,
      anomalies: topoField.anomalies,
    });
  }, [topoField, lod.fps, errorInfo.broken, count]);


  // Apply AI directives — clamps each via per-action caps, records activity,
  // mutates state, and triggers per-node impulses + camera shake on big moves.
  const applyDirectives = useCallback(
    (directives: AIDirective[]) => {
      // Clamp via current caps; drop any whose action is fully disabled.
      // In overclock mode, caps are bypassed entirely (full-send).
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
          nextStats[nodeId] = {
            ...cur,
            total: cur.total + 1,
            counts: { ...cur.counts, [action]: cur.counts[action] + 1 },
            intensitySum: cur.intensitySum + d.intensity,
            intensityAbsSum: cur.intensityAbsSum + Math.abs(d.intensity),
            lastAction: action,
            lastIntensity: d.intensity,
            lastReason: d.reason,
            lastTs: ts,
          };
        });
        return nextStats;
      });

      let maxImpulse = 0;
      clamped.forEach((d) => {
        const nodeId = Math.max(0, Math.min(AI_NODE_COUNT - 1, d.nodeId));
        const idx = count + nodeId;
        const cur = stateMap.current.get(idx) ?? {
          index: idx,
          frozen: false,
          isolated: false,
          boost: 0,
        };
        const next: NodeState = { ...cur };
        switch (d.action) {
          case "boost":   next.boost = d.intensity; next.frozen = false; break;
          case "freeze":  next.frozen = true; break;
          case "isolate": next.isolated = true; break;
          case "release": next.frozen = false; next.isolated = false; next.boost = 0; break;
          case "anomaly": next.boost = Math.max(next.boost, 0.6); next.isolated = true; break;
        }
        stateMap.current.set(idx, next);

        // Impulse: any directive with |intensity| > 0.4 OR an anomaly action
        // pops the node briefly. Anomalies always feed camera shake.
        const amp = d.action === "anomaly"
          ? 0.9
          : Math.abs(d.intensity) > 0.4
          ? Math.abs(d.intensity)
          : 0;
        if (amp > 0) {
          impulseMap.current.set(idx, { expires: ts + 380, amp });
          if (amp > maxImpulse) maxImpulse = amp;
        }
      });

      // Camera shake — only fires on genuinely big impulses so the camera
      // stays cinematic and doesn't feel jittery during normal AI activity.
      // Amplitude is capped tight; visual interest comes from node pulses,
      // not the camera bouncing every 3s.
      if (maxImpulse > 0.7) {
        const dur = maxImpulse > 0.9 ? 260 : 160;
        cameraShakeRef.current = {
          until: ts + dur,
          amp: Math.min(0.08, (maxImpulse - 0.7) * 0.18),
        };
      }

      bumpVisuals();
    },
    [count, bumpVisuals],
  );

  const getSnapshot = useCallback(() => snapshotRef.current, []);
  const { requestCount: aiReqCount, lastError: aiHookError } = useAINodes({
    intervalMs: 30000,
    disabled: !aiEnabled,
    getSnapshot,
    onDirectives: applyDirectives,
  });
  useEffect(() => {
    if (aiHookError) setAiError(aiHookError);
  }, [aiHookError]);

  // STREAMING AI — long-lived SSE that drips one directive at a time.
  // Funnels through the same applyDirectives pipe so caps + impulses + stats
  // all apply identically.
  const onStreamDirective = useCallback(
    (d: AIDirective) => applyDirectives([d]),
    [applyDirectives],
  );
  const {
    status: streamStatus,
    error: streamError,
    streamCount,
    directiveCount: streamDirCount,
    lastLatencyMs: streamLatency,
    reconnect: reconnectStream,
  } = useAIStream({
    disabled: !aiEnabled,
    getSnapshot,
    onDirective: onStreamDirective,
    provider: debugProvider,
    overclock,
    onDebugEvent: handleDebugEvent,
  });

  // SELF-HEALING governor — runs locally at 2Hz. When stability collapses or
  // too many edges break, it auto-releases all AI nodes, clears broken-edge
  // markers, and pulses small randomized boosts to wake the field back up.
  const healActions = useMemo(
    () => ({
      releaseAllAI: () => {
        for (let i = 0; i < AI_NODE_COUNT; i++) {
          const idx = count + i;
          stateMap.current.set(idx, { index: idx, frozen: false, isolated: false, boost: 0 });
        }
        bumpVisuals();
      },
      repairBrokenEdges: () => {
        // Mark visually as 0 broken — actual edge geometry remains, but the
        // overlay/badge clear gives the user feedback that healing happened.
        setErrorInfo((e) => ({ ...e, broken: 0, firstIdx: null }));
      },
      pulseRandomBoosts: (intensity: number) => {
        const ts = Date.now();
        for (let k = 0; k < 6; k++) {
          const nodeId = Math.floor(Math.random() * AI_NODE_COUNT);
          const idx = count + nodeId;
          const sign = Math.random() < 0.5 ? -1 : 1;
          const v = sign * intensity * (0.6 + Math.random() * 0.4);
          stateMap.current.set(idx, {
            index: idx,
            frozen: false,
            isolated: false,
            boost: v,
          });
          impulseMap.current.set(idx, { expires: ts + 350, amp: Math.abs(v) });
        }
        bumpVisuals();
      },
    }),
    [count, bumpVisuals],
  );
  const readHealing = useCallback(
    () => {
      let isolatedAI = 0;
      for (let i = 0; i < AI_NODE_COUNT; i++) {
        if (stateMap.current.get(count + i)?.isolated) isolatedAI++;
      }
      return {
        brokenEdges: errorInfo.broken,
        isolatedAINodes: isolatedAI,
        stability: snapshotRef.current.stability,
        lastHealMs: 0,
        healCount: 0,
      };
    },
    [count, errorInfo.broken],
  );
  const { healEvents } = useSelfHealing({
    enabled: aiEnabled,
    read: readHealing,
    actions: healActions,
  });

  useEffect(() => {
    if (streamError) setAiError(streamError);
  }, [streamError]);

  return (
    <div
      className={cn(
        "relative h-full w-full overflow-hidden rounded-lg border border-border bg-black",
        className,
      )}
    >
      <Canvas
        gl={{
          antialias: true,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.15,
        }}
        dpr={[1, isMobile ? 1.2 : 1.6]}
        camera={{ position: [0, 0, 50], fov: 50 }}
      >
        <color attach="background" args={["#020410"]} />
        <ambientLight intensity={0.6} />
        {/* Topography surface — additive layer, sits behind the tapestry. */}
        {layers.fourD && topoCtl.enabled && (
          <MeshTopographyLayer
            field={topoField}
            influences={influences}
            resolution={lod.topoResolution}
            updateInterval={lod.topoUpdateInterval}
            wireframe={layers.debug}
          />
        )}
        <TapestryMesh
          count={count}
          coreAiCount={CORE_AI_NODE_COUNT}
          governorAiCount={GOVERNOR_AI_NODE_COUNT}
          errorRate={errorRate}
          onError={(info) => setErrorInfo(info)}
          onFocusRequest={(p) => setFocusOn(p)}
          onSelect={handleSelect}
          onHit={layers.debug ? setHit : undefined}
          onInfluences={setInfluences}
          stateMap={stateMap.current}
          selectedIdx={selected?.index ?? null}
          layers={layers}
          impulseMap={impulseMap.current}
        />
        <CameraRig focusOn={focusOn} shakeRef={cameraShakeRef} />
        <OrbitControls
          enableDamping
          dampingFactor={0.08}
          minDistance={10}
          maxDistance={200}
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        />
        {/* Cinematic post-processing — Unreal/Ubisoft-style stack.
            Disabled on the lowest LOD tier to keep mobile responsive. */}
        {!lod.reduced && (
          <EffectComposer multisampling={isMobile ? 0 : 2}>
            <Bloom
              intensity={isMobile ? 0.5 : 0.9}
              luminanceThreshold={0.35}
              luminanceSmoothing={0.4}
              mipmapBlur
            />
            <ChromaticAberration
              offset={new THREE.Vector2(0.0008, 0.0012)}
              radialModulation={false}
              modulationOffset={0}
              blendFunction={BlendFunction.NORMAL}
            />
            <Vignette eskil={false} offset={0.25} darkness={0.85} />
            <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          </EffectComposer>
        )}
      </Canvas>

      <div className="pointer-events-none absolute left-3 top-3 space-y-1">
        <div className="rounded border border-secondary/40 bg-black/60 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-secondary">
          Tapestry · {count.toLocaleString()} params
        </div>
        <div className="rounded border border-border bg-black/60 px-2 py-1 font-mono text-[10px] text-muted-foreground">
          edges {errorInfo.total.toLocaleString()} ·{" "}
          <span className="text-destructive">broken {errorInfo.broken}</span>
        </div>
        <div
          className={cn(
            "rounded border bg-black/60 px-2 py-1 font-mono text-[10px] tabular-nums",
            lod.tier === "high" && "border-secondary/40 text-secondary",
            lod.tier === "med" && "border-accent/40 text-accent",
            lod.tier === "low" && "border-destructive/40 text-destructive",
          )}
        >
          lod {lod.tier} · {lod.fps}fps · res {lod.topoResolution}
        </div>
        {layers.debug && (
          <div className="rounded border border-primary/40 bg-black/70 px-2 py-1 font-mono text-[10px] leading-tight text-primary">
            <div className="text-[9px] uppercase tracking-widest opacity-60">
              raycast hit
            </div>
            {hit ? (
              <div className="tabular-nums">
                <div>id #{hit.instanceId}</div>
                <div className="text-secondary">
                  p ({hit.point[0].toFixed(2)}, {hit.point[1].toFixed(2)}, {hit.point[2].toFixed(2)})
                </div>
                <div className="text-accent">d = {hit.distance.toFixed(3)}</div>
                <div className="text-muted-foreground">
                  scr {hit.screen[0].toFixed(0)}, {hit.screen[1].toFixed(0)}
                </div>
              </div>
            ) : (
              <div className="text-muted-foreground">— tap a node —</div>
            )}
          </div>
        )}
        <TopoControlPanel
          value={topoCtl}
          onChange={setTopoCtl}
          className="w-56"
        />
        <AIActivityPanel stats={aiStats} className="w-56" />
        <AIActionCapsPanel value={actionCaps} onChange={setActionCaps} className="w-56" />
        <AIDebugPanel
          className="w-56"
          events={debugEvents}
          status={streamStatus}
          error={streamError}
          streamCount={streamCount}
          directiveCount={streamDirCount}
          lastLatencyMs={streamLatency}
          provider={debugProvider}
          onProviderChange={setDebugProvider}
          overclock={overclock}
          debugProviderConfigured={true}
          onReconnect={reconnectStream}
        />
        {healEvents.length > 0 && (
          <div className="rounded border border-[hsl(140_60%_55%/0.4)] bg-black/70 px-2 py-1 font-mono text-[9px] text-[hsl(140_60%_75%)] backdrop-blur-md">
            <div className="uppercase tracking-widest opacity-70">self-heal</div>
            {healEvents.slice(0, 3).map((h) => (
              <div key={h.ts} className="tabular-nums opacity-90">
                · {h.reason}
              </div>
            ))}
          </div>
        )}
        <div className="rounded border border-[hsl(265_70%_70%/0.4)] bg-black/60 px-2 py-1 font-mono text-[9px] text-[hsl(265_70%_85%)] backdrop-blur-md">
          stream {streamStatus} · {streamCount}s · {streamDirCount}d
        </div>
      </div>

      <div className="absolute right-3 top-3 flex flex-col items-end gap-2">
        {errorInfo.broken > 0 && (
          <Badge
            variant="destructive"
            className="pointer-events-none animate-pulse font-mono text-[10px]"
          >
            ⚠ {errorInfo.broken} CONN ERR
          </Badge>
        )}
        <Button
          size="sm"
          variant="outline"
          className="pointer-events-auto h-7 font-mono text-[10px]"
          onClick={() => {
            setFocusOn([0, 0, 0]);
            setSelected(null);
            setField(null);
          }}
        >
          Reset view
        </Button>
        {/* OVERCLOCK — full-send: bypass caps, denser stream, max impulses. */}
        <button
          onClick={() => setOverclock((v) => !v)}
          className={cn(
            "pointer-events-auto rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-widest backdrop-blur-md transition-all",
            overclock
              ? "animate-pulse border-[hsl(0_85%_60%)] bg-[hsl(0_85%_60%/0.15)] text-[hsl(0_85%_75%)] shadow-[0_0_20px_hsl(0_85%_60%/0.5)]"
              : "border-muted bg-black/60 text-muted-foreground hover:text-foreground",
          )}
          title={overclock ? "Overclock ON — caps bypassed, dense stream" : "Engage overclock"}
        >
          ⚡ overclock {overclock ? "ON" : "off"}
        </button>
        {/* AI control loop status — clickable to toggle on/off. */}
        <button
          onClick={() => setAiEnabled((v) => !v)}
          className={cn(
            "pointer-events-auto rounded border px-2 py-1 font-mono text-[10px] tabular-nums backdrop-blur-md",
            aiEnabled
              ? "border-[hsl(265_70%_70%)] bg-[hsl(265_70%_70%/0.1)] text-[hsl(265_70%_75%)]"
              : "border-muted bg-black/60 text-muted-foreground",
          )}
        >
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                aiEnabled ? "animate-pulse bg-[hsl(265_70%_70%)]" : "bg-muted",
              )}
            />
            ai · {aiEnabled ? "live" : "off"} · {aiReqCount}t
          </div>
          {aiEnabled && aiDirectives.length > 0 && (
            <div className="mt-0.5 text-left text-[9px] opacity-70">
              {aiDirectives[0].action} · {aiDirectives[0].reason.slice(0, 22)}
            </div>
          )}
          {aiError && (
            <div className="mt-0.5 text-left text-[9px] text-destructive">
              {aiError.slice(0, 28)}
            </div>
          )}
        </button>
      </div>

      {/* Inspector overlay — bottom-left on mobile, bottom-right on desktop */}
      <div
        className={cn(
          "pointer-events-none absolute bottom-3 z-10",
          isMobile ? "left-3 right-3" : "right-3",
        )}
      >
        <NodeInspectorPanel
          state={selected}
          field={field}
          layers={layers}
          onLayersChange={setLayers}
          onFreeze={() => mutateSelected((n) => ({ ...n, frozen: !n.frozen }))}
          onIsolate={() => mutateSelected((n) => ({ ...n, isolated: !n.isolated }))}
          onBoost={(v) => mutateSelected((n) => ({ ...n, boost: v }))}
          onFocus={() => field && setFocusOn(field.pos)}
          onClear={() => {
            setSelected(null);
            setField(null);
          }}
          className={isMobile ? "w-full" : ""}
        />
      </div>
    </div>
  );
}

function CameraRig({
  focusOn,
  shakeRef,
}: {
  focusOn: [number, number, number] | null;
  shakeRef?: React.MutableRefObject<{ until: number; amp: number }>;
}) {
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3());
  const shakeOffset = useRef(new THREE.Vector3());
  const basePos = useRef(new THREE.Vector3());
  useEffect(() => {
    if (focusOn) target.current.set(...focusOn);
  }, [focusOn]);
  useFrame((state) => {
    if (focusOn) camera.lookAt(target.current);

    // Camera shake — tiny per-frame jitter on top of OrbitControls' position.
    // Lower-frequency sinusoids + ease-in/ease-out envelope (smoothstep on
    // remain/duration) so the shake feels like a soft camera bump rather
    // than a high-frequency vibration.
    if (shakeRef) {
      const now = performance.now();
      const until = shakeRef.current.until;
      const amp = shakeRef.current.amp;
      const totalDur = 260; // matches max emit duration
      const remain = until - now;
      if (remain > 0 && amp > 0) {
        // Smooth envelope: ramps in over first 25% then decays smoothly.
        const u = Math.max(0, Math.min(1, remain / totalDur));
        const env = u * u * (3 - 2 * u); // smoothstep
        const k = env * amp;
        const t = state.clock.elapsedTime;
        const ox = Math.sin(t * 11.0) * k;
        const oy = Math.cos(t * 13.0) * k * 0.7;
        const oz = Math.sin(t * 9.0 + 1.7) * k * 0.4;
        camera.position.sub(shakeOffset.current);
        shakeOffset.current.set(ox, oy, oz);
        camera.position.add(shakeOffset.current);
      } else if (shakeOffset.current.lengthSq() > 0) {
        camera.position.sub(shakeOffset.current);
        shakeOffset.current.set(0, 0, 0);
      }
    }
    basePos.current.copy(camera.position);
  });
  return null;
}

function TapestryMesh({
  count,
  coreAiCount,
  governorAiCount,
  errorRate,
  onError,
  onFocusRequest,
  onSelect,
  onHit,
  onInfluences,
  stateMap,
  selectedIdx,
  layers,
  impulseMap,
}: {
  count: number;
  coreAiCount: number;
  governorAiCount: number;
  errorRate: number;
  onError: (info: { total: number; broken: number; firstIdx: number | null }) => void;
  onFocusRequest: (p: [number, number, number]) => void;
  onSelect: (idx: number, readout: NodeFieldReadout) => void;
  onHit?: (hit: {
    instanceId: number;
    point: [number, number, number];
    distance: number;
    screen: [number, number];
    timestamp: number;
  }) => void;
  onInfluences?: (list: NodeInfluence[]) => void;
  stateMap: Map<number, NodeState>;
  selectedIdx: number | null;
  layers: LayerToggles;
  impulseMap: Map<number, { expires: number; amp: number }>;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const linesRef = useRef<THREE.LineSegments>(null);

  const { positions, edges, colors, brokenIdx, brokenCenter, edgeOwners, brokenSet } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const radius = 24;
    for (let i = 0; i < count; i++) {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / count);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const noise =
        1 + 0.18 * Math.sin(phi * 4 + theta * 3) + 0.1 * Math.cos(theta * 7);
      const r = radius * noise;
      positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }

    const k = 3;
    const edgeCount = count * k;
    const edgePos = new Float32Array(edgeCount * 6);
    const edgeCol = new Float32Array(edgeCount * 6);
    const broken: number[] = [];
    const brokenSet = new Set<number>();
    let firstBrokenCenter: [number, number, number] | null = null;
    // owners[i] = list of edge indices that touch node i
    const edgeOwners: number[][] = Array.from({ length: count }, () => []);

    for (let i = 0; i < count; i++) {
      for (let j = 0; j < k; j++) {
        const nbr = (i + ((j + 1) * 7919)) % count;
        const eId = i * k + j;
        const idx = eId * 6;
        edgePos[idx + 0] = positions[i * 3 + 0];
        edgePos[idx + 1] = positions[i * 3 + 1];
        edgePos[idx + 2] = positions[i * 3 + 2];
        edgePos[idx + 3] = positions[nbr * 3 + 0];
        edgePos[idx + 4] = positions[nbr * 3 + 1];
        edgePos[idx + 5] = positions[nbr * 3 + 2];
        edgeOwners[i].push(eId);
        edgeOwners[nbr].push(eId);

        const isBroken = Math.random() < errorRate;
        if (isBroken) {
          broken.push(eId);
          brokenSet.add(eId);
          if (!firstBrokenCenter) {
            firstBrokenCenter = [
              (edgePos[idx + 0] + edgePos[idx + 3]) / 2,
              (edgePos[idx + 1] + edgePos[idx + 4]) / 2,
              (edgePos[idx + 2] + edgePos[idx + 5]) / 2,
            ];
          }
          edgeCol[idx + 0] = 1.0; edgeCol[idx + 1] = 0.1; edgeCol[idx + 2] = 0.15;
          edgeCol[idx + 3] = 1.0; edgeCol[idx + 4] = 0.1; edgeCol[idx + 5] = 0.15;
        } else {
          const t = (i / count);
          edgeCol[idx + 0] = 0.1 + t * 0.3; edgeCol[idx + 1] = 0.7; edgeCol[idx + 2] = 1.0;
          edgeCol[idx + 3] = 0.1 + t * 0.3; edgeCol[idx + 4] = 0.7; edgeCol[idx + 5] = 1.0;
        }
      }
    }

    return {
      positions,
      edges: edgePos,
      colors: edgeCol,
      brokenIdx: broken,
      brokenCenter: firstBrokenCenter,
      edgeOwners,
      brokenSet,
    };
  }, [count, errorRate]);

  useEffect(() => {
    onError({
      total: count * 3,
      broken: brokenIdx.length,
      firstIdx: brokenIdx[0] ?? null,
    });
    if (brokenCenter) {
      const t = setTimeout(() => onFocusRequest(brokenCenter), 200);
      return () => clearTimeout(t);
    }
  }, [count, brokenIdx, brokenCenter, onError, onFocusRequest]);

  // Edge geometry — rebuilt when isolation state forces hiding edges
  const edgeGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(edges, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return g;
  }, [edges, colors]);

  // Apply node visual state (frozen=blue tint, isolated=dim, boost=scale & glow,
  // selected=enlarged accent). Re-runs whenever stateMap mutation tick fires.
  useEffect(() => {
    if (!meshRef.current) return;
    const dummy = new THREE.Object3D();
    const colorA = new THREE.Color("#88e0ff");
    const colorB = new THREE.Color("#ff7733");
    const frozenC = new THREE.Color("#5cc8ff");
    const isolatedC = new THREE.Color("#444a55");
    const selectedC = new THREE.Color("#ffffff");
    const tmp = new THREE.Color();
    const baseScale = 0.18;
    for (let i = 0; i < count; i++) {
      const st = stateMap.get(i);
      let scale = baseScale;
      if (st?.boost) scale *= 1 + st.boost * 0.9;
      if (i === selectedIdx) scale = Math.max(scale, baseScale * 3.2);
      dummy.position.set(
        positions[i * 3 + 0],
        positions[i * 3 + 1],
        positions[i * 3 + 2],
      );
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);

      tmp.copy(colorA).lerp(colorB, i / count);
      if (st?.isolated) tmp.copy(isolatedC);
      else if (st?.frozen) tmp.copy(frozenC);
      if (st?.boost && st.boost > 0) tmp.lerp(new THREE.Color("#ffaa44"), st.boost * 0.7);
      if (st?.boost && st.boost < 0) tmp.multiplyScalar(1 + st.boost * 0.6);
      if (i === selectedIdx) tmp.copy(selectedC);
      meshRef.current.setColorAt(i, tmp);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  }, [positions, count, selectedIdx, stateMap]);

  // Recolor edges when isolation toggles — hide isolated nodes' edges via alpha=0
  useEffect(() => {
    if (!linesRef.current) return;
    const colAttr = linesRef.current.geometry.getAttribute("color") as THREE.BufferAttribute;
    const arr = colAttr.array as Float32Array;
    // reset to base (cheap: re-derive from `colors` reference values + isolation mask)
    for (let i = 0; i < count; i++) {
      const isolated = stateMap.get(i)?.isolated;
      if (!isolated) continue;
      for (const eId of edgeOwners[i]) {
        const idx = eId * 6;
        // dim heavily
        for (let c = 0; c < 6; c++) arr[idx + c] = colors[idx + c] * 0.08;
      }
    }
    // restore non-isolated to original
    for (let i = 0; i < count; i++) {
      if (stateMap.get(i)?.isolated) continue;
      for (const eId of edgeOwners[i]) {
        const idx = eId * 6;
        // only restore if neighbor is also not isolated
        for (let c = 0; c < 6; c++) arr[idx + c] = colors[idx + c];
      }
    }
    colAttr.needsUpdate = true;
  }, [count, edgeOwners, colors, stateMap, selectedIdx]);

  // Emit node-influence list to the topography layer.
  // Active = selected, frozen, isolated (negative weight), or boosted.
  // Projects 3D node position to topo's local XZ plane (the layer is rotated
  // flat onto Y, so we feed (worldX, worldZ) directly).
  useEffect(() => {
    if (!onInfluences) return;
    const out: NodeInfluence[] = [];
    const push = (idx: number, weight: number, radius: number) => {
      if (out.length >= 16) return;
      const x = positions[idx * 3 + 0];
      const z = positions[idx * 3 + 2];
      out.push({ x, z, weight, radius });
    };
    stateMap.forEach((st, idx) => {
      let w = 0;
      let r = 3.0;
      if (st.boost) { w += st.boost * 1.4; r = 3.5; }
      if (st.frozen) { w += 0.4; r = 2.5; }
      if (st.isolated) { w -= 0.6; r = 4.0; }
      if (idx === selectedIdx) { w += 0.8; r = Math.max(r, 4.5); }
      if (Math.abs(w) > 0.01) push(idx, w, r);
    });
    // Always include selected even if no other state — so the user sees the
    // surface respond immediately on tap.
    if (selectedIdx !== null && !stateMap.get(selectedIdx)) {
      push(selectedIdx, 0.6, 4.0);
    }
    onInfluences(out);
  }, [positions, stateMap, selectedIdx, onInfluences]);

  // Subtle rotation — frozen nodes don't rotate; we approximate by simply
  // pausing the whole mesh when selected node is frozen. (Cheap + safe.)
  useFrame((state) => {
    const sel = selectedIdx !== null ? stateMap.get(selectedIdx) : null;
    const paused = sel?.frozen;
    if (!paused) {
      if (meshRef.current) meshRef.current.rotation.y = state.clock.elapsedTime * 0.04;
      if (linesRef.current) linesRef.current.rotation.y = state.clock.elapsedTime * 0.04;
    }
  });

  // Robust pointer / touch picking.
  //
  // Strategy: on pointerdown we record (x, y, t) per pointerId. We do NOT
  // stopPropagation here — that lets OrbitControls receive the down/move and
  // start an orbit drag if the user actually drags. On pointerup, if the
  // pointer moved less than CLICK_PX and the gesture lasted under CLICK_MS,
  // we treat it as a tap and run selection. This works for mouse + touch +
  // pen, and never blocks orbit.
  const CLICK_PX = 6;
  const CLICK_MS = 350;
  const downRef = useRef<Map<number, { x: number; y: number; t: number; instanceId: number | undefined }>>(
    new Map(),
  );

  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.instanceId === undefined) return;
      downRef.current.set(e.pointerId, {
        x: e.nativeEvent.clientX,
        y: e.nativeEvent.clientY,
        t: performance.now(),
        instanceId: e.instanceId,
      });
      // Emit raw raycast hit info for the debug HUD (only when wired).
      onHit?.({
        instanceId: e.instanceId,
        point: [e.point.x, e.point.y, e.point.z],
        distance: e.distance,
        screen: [e.nativeEvent.clientX, e.nativeEvent.clientY],
        timestamp: performance.now(),
      });
    },
    [onHit],
  );

  const handlePointerUp = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const start = downRef.current.get(e.pointerId);
      downRef.current.delete(e.pointerId);
      if (!start || start.instanceId === undefined) return;
      const dx = e.nativeEvent.clientX - start.x;
      const dy = e.nativeEvent.clientY - start.y;
      const dt = performance.now() - start.t;
      if (Math.hypot(dx, dy) > CLICK_PX || dt > CLICK_MS) return; // it was a drag
      // Same instance under pointerup as pointerdown? Prefer up's id when defined.
      const i = e.instanceId ?? start.instanceId;
      e.stopPropagation();
      const px = positions[i * 3 + 0];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];
      const r = Math.sqrt(px * px + py * py + pz * pz);
      const owners = edgeOwners[i] ?? [];
      const broken = owners.filter((eId) => brokenSet.has(eId)).length;
      const Rref = 24;
      const potential = -Rref / Math.max(r, 0.5);
      const redshift = 1 - Math.sqrt(Math.max(0, 1 - 2 / Math.max(r, 2.1)));
      const tidal = 1 / Math.pow(Math.max(r, 1), 3);
      onSelect(i, {
        pos: [px, py, pz],
        rNorm: r / Rref,
        potential,
        redshift,
        tidal,
        edgeCount: owners.length,
        brokenEdges: broken,
      });
    },
    [positions, edgeOwners, brokenSet, onSelect],
  );

  const handlePointerCancel = useCallback((e: ThreeEvent<PointerEvent>) => {
    downRef.current.delete(e.pointerId);
  }, []);

  return (
    <>
      {layers.mesh && (
        <instancedMesh
          ref={meshRef}
          args={[undefined, undefined, count]}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onPointerLeave={handlePointerCancel}
        >
          <sphereGeometry args={[1, 6, 6]} />
          <meshBasicMaterial toneMapped={false} />
        </instancedMesh>
      )}
      {layers.fourD && (
        <lineSegments ref={linesRef} geometry={edgeGeom}>
          <lineBasicMaterial vertexColors transparent opacity={0.55} />
        </lineSegments>
      )}
      {layers.debug && brokenCenter && <BrokenMarker position={brokenCenter} />}
      <AINodeRing
        baseIdx={count}
        coreCount={coreAiCount}
        governorCount={governorAiCount}
        stateMap={stateMap}
        impulseMap={impulseMap}
        onSelect={(absIdx, pos) => {
          const Rref = 24;
          const r = Math.hypot(pos[0], pos[1], pos[2]);
          onSelect(absIdx, {
            pos,
            rNorm: r / Rref,
            potential: -Rref / Math.max(r, 0.5),
            redshift: 1 - Math.sqrt(Math.max(0, 1 - 2 / Math.max(r, 2.1))),
            tidal: 1 / Math.pow(Math.max(r, 1), 3),
            edgeCount: 0,
            brokenEdges: 0,
          });
        }}
      />
    </>
  );
}

/**
 * AINodeRing — dedicated AI control nodes.
 *   - First `coreCount` (6) live on a tilted INNER ring as large violet
 *     icosahedra; they are the primary actuators.
 *   - The remaining (65) GOVERNOR nodes live on an outer spherical halo,
 *     rendered as smaller emissive points connected by faint lines back to
 *     their assigned core node. Governors fine-tune what the core does.
 *
 * State for ALL of them lives in `stateMap` at indices
 * baseIdx..baseIdx+coreCount+governorCount-1, so directives flow through
 * the same boost/freeze/isolate pipeline.
 */
function AINodeRing({
  baseIdx,
  coreCount,
  governorCount,
  stateMap,
  impulseMap,
  onSelect,
}: {
  baseIdx: number;
  coreCount: number;
  governorCount: number;
  stateMap: Map<number, NodeState>;
  impulseMap: Map<number, { expires: number; amp: number }>;
  onSelect: (absIdx: number, pos: [number, number, number]) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const coreRefs = useRef<(THREE.Mesh | null)[]>([]);
  const govRefs = useRef<(THREE.Mesh | null)[]>([]);
  const innerRadius = 14;
  const outerRadius = 20;

  // Static core positions — tilted equatorial ring.
  const corePositions = useMemo<[number, number, number][]>(() => {
    return Array.from({ length: coreCount }, (_, i) => {
      const angle = (i / coreCount) * Math.PI * 2;
      const tilt = 0.35;
      return [
        innerRadius * Math.cos(angle),
        innerRadius * Math.sin(angle) * tilt,
        innerRadius * Math.sin(angle),
      ];
    });
  }, [coreCount]);

  // Static governor positions — Fibonacci sphere shell at outerRadius.
  // Each governor is mapped to one core node (round-robin) so we can draw
  // a connector line; this also defines the "helping" relationship.
  const governorData = useMemo(() => {
    const positions: [number, number, number][] = [];
    const coreOf: number[] = [];
    for (let i = 0; i < governorCount; i++) {
      const phi = Math.acos(1 - (2 * (i + 0.5)) / governorCount);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      positions.push([
        outerRadius * Math.sin(phi) * Math.cos(theta),
        outerRadius * Math.sin(phi) * Math.sin(theta),
        outerRadius * Math.cos(phi),
      ]);
      coreOf.push(i % coreCount);
    }
    return { positions, coreOf };
  }, [governorCount, coreCount]);

  // Pre-built connector geometry: 2 verts per governor, vertex-colored.
  const connectorGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(governorCount * 6);
    const col = new Float32Array(governorCount * 6);
    for (let i = 0; i < governorCount; i++) {
      const gp = governorData.positions[i];
      const cp = corePositions[governorData.coreOf[i]];
      pos.set([gp[0], gp[1], gp[2], cp[0], cp[1], cp[2]], i * 6);
      // violet → cyan gradient: governor end soft, core end brighter.
      col.set([0.55, 0.42, 0.85, 0.66, 0.48, 1.0], i * 6);
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return g;
  }, [governorCount, governorData, corePositions]);

  // Slow counter-rotation + impulse decay. Impulses pop a node's scale and
  // jitter its position briefly when AI fires a high-intensity directive.
  useFrame((s) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = -s.clock.elapsedTime * 0.12;
    }
    const now = performance.now();
    const t = s.clock.elapsedTime;
    // Core impulse animation
    for (let i = 0; i < coreCount; i++) {
      const ref = coreRefs.current[i];
      if (!ref) continue;
      const imp = impulseMap.get(baseIdx + i);
      if (imp && imp.expires > now) {
        const k = (imp.expires - now) / 380;
        const pop = 1 + imp.amp * 0.7 * k;
        ref.scale.setScalar(pop);
        const j = imp.amp * 0.4 * k;
        ref.position.set(
          corePositions[i][0] + Math.sin(t * 40 + i) * j,
          corePositions[i][1] + Math.cos(t * 47 + i) * j,
          corePositions[i][2] + Math.sin(t * 33 + i) * j,
        );
      } else {
        if (ref.scale.x !== 1) ref.scale.setScalar(1);
        const p = corePositions[i];
        if (ref.position.x !== p[0]) ref.position.set(p[0], p[1], p[2]);
      }
    }
    // Governor impulse animation (smaller amp)
    for (let i = 0; i < governorCount; i++) {
      const ref = govRefs.current[i];
      if (!ref) continue;
      const imp = impulseMap.get(baseIdx + coreCount + i);
      if (imp && imp.expires > now) {
        const k = (imp.expires - now) / 380;
        ref.scale.setScalar(1 + imp.amp * 1.2 * k);
        const j = imp.amp * 0.25 * k;
        const p = governorData.positions[i];
        ref.position.set(
          p[0] + Math.sin(t * 51 + i) * j,
          p[1] + Math.cos(t * 47 + i) * j,
          p[2] + Math.sin(t * 39 + i) * j,
        );
      } else {
        if (ref.scale.x !== 1) ref.scale.setScalar(1);
        const p = governorData.positions[i];
        if (ref.position.x !== p[0]) ref.position.set(p[0], p[1], p[2]);
      }
    }
    // GC expired entries opportunistically.
    if (impulseMap.size > 0 && Math.random() < 0.02) {
      for (const [k, v] of impulseMap) if (v.expires < now) impulseMap.delete(k);
    }
  });

  return (
    <group ref={groupRef}>
      {/* Connector lines — drawn first so nodes render on top. */}
      <lineSegments geometry={connectorGeom}>
        <lineBasicMaterial vertexColors transparent opacity={0.18} />
      </lineSegments>

      {/* Core 6 — large icosahedra with pulse rings. */}
      {corePositions.map((p, i) => {
        const absIdx = baseIdx + i;
        const st = stateMap.get(absIdx);
        const isFrozen = st?.frozen;
        const isIsolated = st?.isolated;
        const boost = st?.boost ?? 0;
        const baseColor = isIsolated
          ? "#5c6273"
          : isFrozen
          ? "#5cc8ff"
          : boost > 0.3
          ? "#ffaa44"
          : "#a87bff";
        const scale = 0.55 + Math.abs(boost) * 0.5;
        return (
          <group
            key={absIdx}
            position={p}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect(absIdx, p);
            }}
          >
            <mesh ref={(m) => { coreRefs.current[i] = m; }}>
              <icosahedronGeometry args={[scale, 1]} />
              <meshBasicMaterial color={baseColor} toneMapped={false} />
            </mesh>
            <AIPulseRing color={baseColor} radius={scale * 1.8} phase={i * 0.7} />
          </group>
        );
      })}

      {/* Governors — smaller octahedra on the outer halo. */}
      {governorData.positions.map((p, i) => {
        const absIdx = baseIdx + coreCount + i;
        const st = stateMap.get(absIdx);
        const isFrozen = st?.frozen;
        const isIsolated = st?.isolated;
        const boost = st?.boost ?? 0;
        const baseColor = isIsolated
          ? "#3a3f4a"
          : isFrozen
          ? "#7fd6ff"
          : boost > 0.3
          ? "#ffcc77"
          : "#9d6cff";
        const scale = 0.18 + Math.abs(boost) * 0.25;
        return (
          <mesh
            ref={(m) => { govRefs.current[i] = m; }}
            key={absIdx}
            position={p}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect(absIdx, p);
            }}
          >
            <octahedronGeometry args={[scale, 0]} />
            <meshBasicMaterial color={baseColor} toneMapped={false} />
          </mesh>
        );
      })}
    </group>
  );
}

function AIPulseRing({
  color,
  radius,
  phase,
}: {
  color: string;
  radius: number;
  phase: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((s) => {
    if (!ref.current) return;
    const k = 1 + Math.sin(s.clock.elapsedTime * 1.6 + phase) * 0.18;
    ref.current.scale.setScalar(k);
    const m = ref.current.material as THREE.MeshBasicMaterial;
    m.opacity = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(s.clock.elapsedTime * 1.6 + phase));
  });
  return (
    <mesh ref={ref} rotation={[Math.PI / 2, 0, 0]}>
      <ringGeometry args={[radius * 0.95, radius, 32]} />
      <meshBasicMaterial
        color={color}
        toneMapped={false}
        transparent
        opacity={0.5}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function BrokenMarker({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((s) => {
    if (ref.current) {
      const k = 1 + Math.sin(s.clock.elapsedTime * 4) * 0.3;
      ref.current.scale.setScalar(k);
    }
  });
  return (
    <mesh ref={ref} position={position}>
      <ringGeometry args={[1.2, 1.5, 32]} />
      <meshBasicMaterial color="#ff2244" toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );
}
