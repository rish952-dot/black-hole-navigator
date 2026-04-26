import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
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
import {
  TopoControlPanel,
  DEFAULT_TOPO_CONTROLS,
  type TopoControls,
} from "./views/TopoControlPanel";

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
  const count = nodeCount ?? (isMobile ? 3000 : 30000);
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
    const energy = Math.min(1.5, 0.4 + Math.abs(boostSum) * 0.3 + influenced * 0.05);
    const stability = Math.max(0, 1 - (isolatedCount * 0.08 + errorInfo.broken * 0.05));
    // Curvature spikes when a node is selected (focus a "well" under it).
    const curvature = selected ? 1.0 + (selected.boost * 0.4 || 0) : 0.5;
    const flowAngle = (frozenCount * 0.7) % (Math.PI * 2);
    const anomalies = Math.min(6, errorInfo.broken);
    return { curvature, energyDensity: energy, stability, flowAngle, anomalies };
  }, [selected, errorInfo]);

  return (
    <div
      className={cn(
        "relative h-full w-full overflow-hidden rounded-lg border border-border bg-black",
        className,
      )}
    >
      <Canvas
        gl={{ antialias: true, powerPreference: "high-performance" }}
        dpr={[1, isMobile ? 1.2 : 1.6]}
        camera={{ position: [0, 0, 50], fov: 50 }}
      >
        <color attach="background" args={["#020410"]} />
        <ambientLight intensity={0.6} />
        {/* Topography surface — additive layer, sits behind the tapestry. */}
        {layers.fourD && (
          <MeshTopographyLayer
            field={topoField}
            influences={influences}
            resolution={isMobile ? 64 : 128}
            wireframe={layers.debug}
          />
        )}
        <TapestryMesh
          count={count}
          errorRate={errorRate}
          onError={(info) => setErrorInfo(info)}
          onFocusRequest={(p) => setFocusOn(p)}
          onSelect={handleSelect}
          onHit={layers.debug ? setHit : undefined}
          onInfluences={setInfluences}
          stateMap={stateMap.current}
          selectedIdx={selected?.index ?? null}
          layers={layers}
        />
        <CameraRig focusOn={focusOn} />
        <OrbitControls
          enableDamping
          dampingFactor={0.08}
          minDistance={10}
          maxDistance={200}
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        />
      </Canvas>

      <div className="pointer-events-none absolute left-3 top-3 space-y-1">
        <div className="rounded border border-secondary/40 bg-black/60 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-secondary">
          Tapestry · {count.toLocaleString()} params
        </div>
        <div className="rounded border border-border bg-black/60 px-2 py-1 font-mono text-[10px] text-muted-foreground">
          edges {errorInfo.total.toLocaleString()} ·{" "}
          <span className="text-destructive">broken {errorInfo.broken}</span>
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

function CameraRig({ focusOn }: { focusOn: [number, number, number] | null }) {
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3());
  useEffect(() => {
    if (focusOn) target.current.set(...focusOn);
  }, [focusOn]);
  useFrame(() => {
    if (focusOn) {
      camera.lookAt(target.current);
    }
  });
  return null;
}

function TapestryMesh({
  count,
  errorRate,
  onError,
  onFocusRequest,
  onSelect,
  onHit,
  onInfluences,
  stateMap,
  selectedIdx,
  layers,
}: {
  count: number;
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
    </>
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
