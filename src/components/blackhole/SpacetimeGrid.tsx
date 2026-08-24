import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { SafeCanvas } from "./SafeCanvas";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { cn } from "@/lib/utils";

interface Props {
  mass: number;
  spin: number;
  className?: string;
  starCount?: number;
  /** vector scale: 0.25..4 — multiplies grid warp depth */
  vectorScale?: number;
  /** dark-matter only mode: hides BH well, shows DM halo as broad bowl */
  darkOnly?: boolean;
  /** strain amplitude of injected gravitational wave ripple (0 = off) */
  gwAmplitude?: number;
  /** GW frequency (Hz-ish) of injected ripple */
  gwFrequency?: number;
}

/**
 * 4D spacetime grid + autonomous orbiting stars.
 *
 * The grid is a 3D mesh whose vertices are warped by an embedding of the
 * Schwarzschild "Flamm paraboloid": z(r) = 2 sqrt(r_s (r - r_s)).
 * That is the canonical 2D slice of a 4D spacetime projected into 3D.
 *
 * Stars are individual entities — each holds its own (a, e, phase, inclination)
 * orbital element set and integrates independently each frame using a tiny
 * post-Newtonian step (effective potential precession ∝ M/r).
 */
export function SpacetimeGrid({
  mass,
  spin,
  className,
  starCount = 600,
  vectorScale = 1.0,
  darkOnly = false,
  gwAmplitude = 0,
  gwFrequency = 1.5,
}: Props) {
  return (
    <div
      className={cn(
        "relative h-full w-full overflow-hidden rounded-lg border border-border bg-black",
        className,
      )}
    >
      <SafeCanvas
        gl={{ antialias: true, powerPreference: "high-performance" }}
        dpr={[1, 1.6]}
        camera={{ position: [22, 14, 22], fov: 55 }}
      >
        <color attach="background" args={["#02030a"]} />
        <ambientLight intensity={0.3} />
        <pointLight position={[0, 0, 0]} intensity={4} color="#ffaa55" distance={50} />

        <FlammGrid
          mass={mass}
          spin={spin}
          vectorScale={vectorScale}
          darkOnly={darkOnly}
          gwAmplitude={gwAmplitude}
          gwFrequency={gwFrequency}
        />
        {!darkOnly && <Singularity mass={mass} />}
        <AutonomousStars count={starCount} mass={mass} spin={spin} />

        <OrbitControls
          enablePan
          enableZoom
          enableRotate
          enableDamping
          dampingFactor={0.08}
          minDistance={6}
          maxDistance={120}
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        />
      </SafeCanvas>
      <div className="pointer-events-none absolute left-3 top-3 space-y-1">
        <div className="rounded border border-secondary/40 bg-black/60 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-secondary">
          4D · Flamm embedding · {starCount} entities
        </div>
        {gwAmplitude > 0 && (
          <div className="rounded border border-accent/40 bg-black/60 px-2 py-1 font-mono text-[10px] text-accent">
            GW ripple · A={gwAmplitude.toFixed(2)} · f={gwFrequency.toFixed(2)}
          </div>
        )}
        {darkOnly && (
          <div className="rounded border border-destructive/40 bg-black/60 px-2 py-1 font-mono text-[10px] text-destructive">
            DM-ONLY · BH well suppressed
          </div>
        )}
      </div>
    </div>
  );
}

function Singularity({ mass }: { mass: number }) {
  const r_s = 2 * mass;
  return (
    <mesh>
      <sphereGeometry args={[r_s * 0.5, 32, 32]} />
      <meshBasicMaterial color="#000000" />
    </mesh>
  );
}

function FlammGrid({
  mass,
  spin,
  vectorScale,
  darkOnly,
  gwAmplitude,
  gwFrequency,
}: {
  mass: number;
  spin: number;
  vectorScale: number;
  darkOnly: boolean;
  gwAmplitude: number;
  gwFrequency: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const r_s = 2 * mass;

  // Reference flat positions are stored separately so we can re-warp each
  // frame when a gravitational-wave ripple is active.
  const { geom, basePos } = useMemo(() => {
    const size = 80;
    const seg = 100;
    const g = new THREE.PlaneGeometry(size, size, seg, seg);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const base = new Float32Array(pos.count * 2); // store (x, z) only
    for (let i = 0; i < pos.count; i++) {
      base[i * 2 + 0] = pos.getX(i);
      base[i * 2 + 1] = pos.getZ(i);
    }
    return { geom: g, basePos: base };
  }, []);

  useFrame((s) => {
    if (!meshRef.current) return;
    const t = s.clock.elapsedTime;
    const pos = geom.attributes.position;
    const haloR = 30; // DM bowl scale

    for (let i = 0; i < pos.count; i++) {
      const x = basePos[i * 2 + 0];
      const z = basePos[i * 2 + 1];
      const r = Math.sqrt(x * x + z * z);

      // Schwarzschild Flamm well (suppressed in dark-only mode)
      let y = 0;
      if (!darkOnly) {
        if (r > r_s) y -= 2 * Math.sqrt(r_s * (r - r_s));
        else y -= 2 * Math.sqrt(r_s * 0.001);
      }
      // NFW-like dark matter bowl: shallow, broad
      y -= 0.6 * Math.log(1 + r / haloR) * vectorScale;
      // Multiply BH well by vector scale
      y *= vectorScale * (darkOnly ? 0.0 : 1.0) + (darkOnly ? 1.0 : 0.0);

      // Gravitational-wave ripple: + polarization plane wave
      if (gwAmplitude > 0) {
        const k = gwFrequency * 0.4;
        const omega = gwFrequency * 1.2;
        // expanding ring h_+ = A sin(k r - ω t)/r at large r
        const env = Math.exp(-Math.pow(r - omega * t * 5, 2) / 80) + 0.3 / (1 + r * 0.1);
        y += gwAmplitude * 4 * Math.sin(k * r - omega * t) * env;
      }
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
    geom.computeVertexNormals();

    // frame-dragging twist
    meshRef.current.rotation.y = t * spin * 0.05;
  });

  return (
    <mesh ref={meshRef} geometry={geom}>
      <meshStandardMaterial
        color="#1a3a6a"
        wireframe
        transparent
        opacity={0.45}
        emissive="#0a1a3a"
        emissiveIntensity={0.6}
      />
    </mesh>
  );
}

function AutonomousStars({
  count,
  mass,
  spin,
}: {
  count: number;
  mass: number;
  spin: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Each star: independent orbital elements
  const stars = useMemo(() => {
    const arr: {
      a: number;
      e: number;
      phase: number;
      incl: number;
      ascNode: number;
      color: THREE.Color;
      precession: number;
    }[] = [];
    for (let i = 0; i < count; i++) {
      const a = 8 + Math.random() * 60;
      const e = Math.random() * 0.4;
      const phase = Math.random() * Math.PI * 2;
      const incl = (Math.random() - 0.5) * 0.6;
      const ascNode = Math.random() * Math.PI * 2;
      // B-V color → tint
      const bv = Math.random() * 1.8 - 0.3;
      const r = 1.0;
      const g = 1.0 - Math.max(bv, 0) * 0.3;
      const b = 1.0 - Math.max(bv, 0) * 0.6 + Math.max(-bv, 0) * 0.3;
      arr.push({
        a,
        e,
        phase,
        incl,
        ascNode,
        color: new THREE.Color(r, g, b),
        precession: 0,
      });
    }
    return arr;
  }, [count]);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      // Mean motion ~ sqrt(M/a^3) (Kepler) with relativistic precession
      const n = Math.sqrt(mass / Math.pow(s.a, 3));
      // precession rate ∝ 6πM/(a(1-e^2)) per orbit, scaled
      const precRate = (6 * Math.PI * mass) / (s.a * (1 - s.e * s.e)) * 0.001;
      s.precession += precRate;
      const M = n * t * 8 + s.phase;
      // Solve Kepler approx (low e)
      const E = M + s.e * Math.sin(M);
      const cosE = Math.cos(E);
      const sinE = Math.sin(E);
      const xOrb = s.a * (cosE - s.e);
      const yOrb = s.a * Math.sqrt(1 - s.e * s.e) * sinE;

      // rotate by precession in orbital plane, then by ascNode + frame-drag
      const w = s.precession + s.ascNode + spin * t * 0.02;
      const cw = Math.cos(w);
      const sw = Math.sin(w);
      const x1 = xOrb * cw - yOrb * sw;
      const y1 = xOrb * sw + yOrb * cw;

      // inclination tilt
      const ci = Math.cos(s.incl);
      const si = Math.sin(s.incl);
      const x = x1;
      const y = y1 * si;
      const z = y1 * ci;

      dummy.position.set(x, y, z);
      const scale = 0.12 + (1 / Math.max(s.a / 20, 0.5)) * 0.08;
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
      meshRef.current.setColorAt(i, s.color);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}
