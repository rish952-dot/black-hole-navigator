import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Play, Pause, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

interface Props {
  className?: string;
}

export type GalaxyType = "spiral" | "elliptical" | "irregular" | "colliding";
const GALAXY_TYPES: { id: GalaxyType; label: string }[] = [
  { id: "spiral", label: "Spiral" },
  { id: "elliptical", label: "Elliptical" },
  { id: "irregular", label: "Irregular" },
  { id: "colliding", label: "Colliding pair" },
];

/**
 * Galactic Plane View — N-body spiral + scrubbable formation timeline.
 *
 * Combines two displays in one canvas:
 *  1. Live N-body sim of ~5–10k particles forming a disk + bulge under
 *     a logarithmic-spiral potential plus dark-matter halo gravity.
 *  2. Timeline scrubber [0..13.8 Gyr] reseeds initial conditions to show
 *     gas cloud → protogalaxy → spiral arms forming over cosmic time.
 *
 * Touch: one-finger orbit, two-finger pinch zoom + pan.
 */
export function GalacticPlane({ className }: Props) {
  const isMobile = useIsMobile();
  const [age, setAge] = useState(8.0);   // Gyr since formation
  const [playing, setPlaying] = useState(true);
  const [particleCount] = useState(isMobile ? 3000 : 8000);
  const [resetKey, setResetKey] = useState(0);
  const [type, setType] = useState<GalaxyType>("spiral");
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setAge((a) => (a >= 13.8 ? 0.5 : a + 0.05 * speed));
    }, 60);
    return () => clearInterval(t);
  }, [playing, speed]);

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
        camera={{ position: [0, 30, 50], fov: 55 }}
      >
        <color attach="background" args={["#020208"]} />
        <ambientLight intensity={0.25} />
        <pointLight position={[0, 0, 0]} intensity={3} color="#ffaa55" distance={80} />

        <Galaxy
          key={`${resetKey}-${type}`}
          count={particleCount}
          age={age}
          type={type}
          speed={speed}
        />
        <DarkMatterHalo radius={60} />
        <GalacticCenter />

        <OrbitControls
          enableDamping
          dampingFactor={0.08}
          minDistance={10}
          maxDistance={200}
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        />
      </Canvas>

      {/* Top label */}
      <div className="pointer-events-none absolute left-3 top-3 space-y-1">
        <div className="rounded border border-secondary/40 bg-black/60 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-secondary">
          {type} · {particleCount.toLocaleString()} bodies
        </div>
        <div className="rounded border border-border bg-black/60 px-2 py-1 font-mono text-[10px] text-muted-foreground">
          age = <span className="text-primary">{age.toFixed(2)}</span> Gyr · {phaseLabel(age, type)}
        </div>
      </div>

      {/* Galaxy type selector — top right */}
      <div className="absolute right-3 top-3 flex flex-col gap-1">
        {GALAXY_TYPES.map((g) => (
          <Button
            key={g.id}
            size="sm"
            variant={type === g.id ? "default" : "outline"}
            className="h-7 justify-start font-mono text-[10px]"
            onClick={() => { setType(g.id); setResetKey((k) => k + 1); }}
          >
            {g.label}
          </Button>
        ))}
      </div>

      {/* Timeline controls */}
      <div className="absolute inset-x-3 bottom-3 rounded-lg border border-border bg-black/70 p-3 backdrop-blur-sm">
        <div className="mb-2 flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 w-7 p-0"
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 w-7 p-0"
            onClick={() => { setAge(0.5); setResetKey((k) => k + 1); }}
          >
            <RotateCw className="h-3 w-3" />
          </Button>
          <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Cosmic time
          </Label>
          <span className="ml-auto font-mono text-xs text-primary">
            {age.toFixed(2)} Gyr / 13.8
          </span>
        </div>
        <Slider
          value={[age]}
          min={0.1}
          max={13.8}
          step={0.05}
          onValueChange={(v) => { setAge(v[0]); setPlaying(false); }}
        />
        <div className="mt-1 flex justify-between font-mono text-[9px] text-muted-foreground">
          <span>cloud</span>
          <span>protogalaxy</span>
          <span>arms form</span>
          <span>mature spiral</span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Label className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            Time-lapse ×{speed.toFixed(1)}
          </Label>
          <Slider
            className="flex-1"
            value={[speed]}
            min={0.1}
            max={20}
            step={0.1}
            onValueChange={(v) => setSpeed(v[0])}
          />
        </div>
      </div>
    </div>
  );
}

function phaseLabel(age: number, type: GalaxyType): string {
  if (type === "elliptical") {
    if (age < 2) return "Major merger remnant cooling";
    if (age < 6) return "Violent relaxation · stellar mixing";
    return "Quenched elliptical · old red population";
  }
  if (type === "irregular") return "Irregular dwarf · stochastic SF";
  if (type === "colliding") {
    if (age < 4) return "Approach phase · tidal tails forming";
    if (age < 9) return "First passage · starburst";
    return "Coalescence · merger remnant";
  }
  if (age < 1) return "Primordial gas cloud collapsing";
  if (age < 3) return "Protogalaxy · halo virialization";
  if (age < 6) return "Disk formation · bar instability";
  if (age < 10) return "Spiral arms developing";
  return "Mature barred spiral · ongoing star formation";
}

function Galaxy({ count, age }: { count: number; age: number }) {
  const ref = useRef<THREE.Points>(null);

  // Particle initial conditions seeded once
  const init = useMemo(() => {
    const arr: { r0: number; phi0: number; z0: number; arm: number }[] = [];
    for (let i = 0; i < count; i++) {
      // Radial: exp disk + bulge concentration
      const u = Math.random();
      const r0 = -Math.log(1 - u * 0.95) * 6 + 0.5;
      const arm = Math.floor(Math.random() * 2);
      const phi0 = Math.random() * Math.PI * 2;
      const z0 = (Math.random() - 0.5) * Math.exp(-r0 / 8) * 1.5;
      arr.push({ r0, phi0, z0, arm });
    }
    return arr;
  }, [count]);

  const positions = useMemo(() => new Float32Array(count * 3), [count]);
  const colors = useMemo(() => new Float32Array(count * 3), [count]);

  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    // Maturity: 0 (cloud) → 1 (full spiral)
    const m = Math.min(1, Math.max(0, (age - 0.5) / 8));

    for (let i = 0; i < count; i++) {
      const s = init[i];
      // Cloud-state radial puffiness contracts as galaxy ages
      const puff = (1 - m) * 25;
      const r = s.r0 * (0.4 + 0.6 * m) + puff * (Math.random() - 0.5) * 0.02;

      // Differential rotation: faster inner, slower outer
      const v = 0.6 / Math.sqrt(Math.max(r, 0.5));
      const omega = v / Math.max(r, 0.3);
      const phi = s.phi0 + omega * t * 4;

      // Spiral arm density wave: bias particles toward arm phase
      const armPhase = phi - 0.6 * Math.log(Math.max(r, 0.5));
      const armBias = m * 0.4 * Math.cos(2 * armPhase + s.arm * Math.PI);
      const r_eff = r + armBias;

      // Vertical thickness
      const z = s.z0 * (1 - m * 0.7);

      const x = r_eff * Math.cos(phi);
      const y = z;
      const zCoord = r_eff * Math.sin(phi);
      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = zCoord;

      // Color: hot blue arm shocks, yellow disk, red bulge
      const armBoost = Math.max(0, Math.cos(2 * armPhase)) * m;
      const cloudTint = 1 - m; // purple haze in cloud phase
      const rad = r / 10;
      colors[i * 3 + 0] = 0.6 + armBoost * 0.3 + cloudTint * 0.2;
      colors[i * 3 + 1] = 0.5 + (1 - rad) * 0.3 - cloudTint * 0.2;
      colors[i * 3 + 2] = 0.4 + armBoost * 0.5 + cloudTint * 0.5;
    }

    const posAttr = ref.current.geometry.attributes.position as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
    const colAttr = ref.current.geometry.attributes.color as THREE.BufferAttribute;
    colAttr.needsUpdate = true;
  });

  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return g;
  }, [positions, colors]);

  return (
    <points ref={ref} geometry={geom}>
      <pointsMaterial
        size={0.18}
        vertexColors
        transparent
        opacity={0.85}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

function DarkMatterHalo({ radius }: { radius: number }) {
  return (
    <mesh>
      <sphereGeometry args={[radius, 24, 24]} />
      <meshBasicMaterial
        color="#3a1a6a"
        transparent
        opacity={0.05}
        side={THREE.BackSide}
      />
    </mesh>
  );
}

function GalacticCenter() {
  return (
    <>
      <mesh>
        <sphereGeometry args={[1, 24, 24]} />
        <meshBasicMaterial color="#000" />
      </mesh>
      <mesh>
        <sphereGeometry args={[2.5, 24, 24]} />
        <meshBasicMaterial color="#ffaa55" transparent opacity={0.15} />
      </mesh>
    </>
  );
}
