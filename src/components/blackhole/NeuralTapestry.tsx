import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useIsMobile } from "@/hooks/use-mobile";

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
        <TapestryMesh
          count={count}
          errorRate={errorRate}
          onError={(info) => setErrorInfo(info)}
          onFocusRequest={(p) => setFocusOn(p)}
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
          onClick={() => setFocusOn([0, 0, 0])}
        >
          Reset view
        </Button>
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
}: {
  count: number;
  errorRate: number;
  onError: (info: { total: number; broken: number; firstIdx: number | null }) => void;
  onFocusRequest: (p: [number, number, number]) => void;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const linesRef = useRef<THREE.LineSegments>(null);

  // Build node positions on a Fibonacci sphere shell + radial noise to make a
  // 3D topography (mountains/valleys) of parameters.
  const { positions, edges, colors, brokenIdx, brokenCenter } = useMemo(() => {
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

    // Build edges: each node connects to ~3 nearest-by-index neighbors
    // (gives a clean small-world graph at ~3N edges).
    const k = 3;
    const edgeCount = count * k;
    const edgePos = new Float32Array(edgeCount * 6);
    const edgeCol = new Float32Array(edgeCount * 6);
    const broken: number[] = [];
    let firstBrokenCenter: [number, number, number] | null = null;

    for (let i = 0; i < count; i++) {
      for (let j = 0; j < k; j++) {
        const nbr = (i + ((j + 1) * 7919)) % count;
        const idx = (i * k + j) * 6;
        edgePos[idx + 0] = positions[i * 3 + 0];
        edgePos[idx + 1] = positions[i * 3 + 1];
        edgePos[idx + 2] = positions[i * 3 + 2];
        edgePos[idx + 3] = positions[nbr * 3 + 0];
        edgePos[idx + 4] = positions[nbr * 3 + 1];
        edgePos[idx + 5] = positions[nbr * 3 + 2];

        const isBroken = Math.random() < errorRate;
        if (isBroken) {
          broken.push(i * k + j);
          if (!firstBrokenCenter) {
            firstBrokenCenter = [
              (edgePos[idx + 0] + edgePos[idx + 3]) / 2,
              (edgePos[idx + 1] + edgePos[idx + 4]) / 2,
              (edgePos[idx + 2] + edgePos[idx + 5]) / 2,
            ];
          }
          // bright red
          edgeCol[idx + 0] = 1.0; edgeCol[idx + 1] = 0.1; edgeCol[idx + 2] = 0.15;
          edgeCol[idx + 3] = 1.0; edgeCol[idx + 4] = 0.1; edgeCol[idx + 5] = 0.15;
        } else {
          // plasma cyan with mild gradient
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
    };
  }, [count, errorRate]);

  // Report broken connections + auto-focus
  useEffect(() => {
    onError({
      total: count * 3,
      broken: brokenIdx.length,
      firstIdx: brokenIdx[0] ?? null,
    });
    if (brokenCenter) {
      // Defer to next tick so Canvas mounts first
      const t = setTimeout(() => onFocusRequest(brokenCenter), 200);
      return () => clearTimeout(t);
    }
  }, [count, brokenIdx, brokenCenter, onError, onFocusRequest]);

  // Build edge geometry once
  const edgeGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(edges, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return g;
  }, [edges, colors]);

  // Place node instances
  useEffect(() => {
    if (!meshRef.current) return;
    const dummy = new THREE.Object3D();
    const colorA = new THREE.Color("#88e0ff");
    const colorB = new THREE.Color("#ff7733");
    const tmp = new THREE.Color();
    for (let i = 0; i < count; i++) {
      dummy.position.set(
        positions[i * 3 + 0],
        positions[i * 3 + 1],
        positions[i * 3 + 2],
      );
      dummy.scale.setScalar(0.18);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
      tmp.copy(colorA).lerp(colorB, i / count);
      meshRef.current.setColorAt(i, tmp);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  }, [positions, count]);

  // Subtle rotation
  useFrame((state) => {
    if (meshRef.current) meshRef.current.rotation.y = state.clock.elapsedTime * 0.04;
    if (linesRef.current) linesRef.current.rotation.y = state.clock.elapsedTime * 0.04;
  });

  return (
    <>
      <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
        <sphereGeometry args={[1, 6, 6]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <lineSegments ref={linesRef} geometry={edgeGeom}>
        <lineBasicMaterial vertexColors transparent opacity={0.55} />
      </lineSegments>
      {brokenCenter && <BrokenMarker position={brokenCenter} />}
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
