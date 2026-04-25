import { useMemo, useRef, useState, useCallback } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DiskProbePanel, type DiskSample } from "./DiskProbePanel";

interface Props {
  mass: number;
  spin: number;
  diskInner: number;
  diskOuter: number;
  className?: string;
}

/**
 * Accretion Disk Study — interactive 3D thin-disk + Shakura-Sunyaev profile.
 *
 * Physics:
 *   T(r) = T_0 · (r/r_s)^(-3/4) · (1 - sqrt(r_in/r))^(1/4)
 *   F(r) = σ T^4 (Stefan-Boltzmann flux per unit area)
 *   L_disk = ∫ 2π r F(r) dr   (bolometric luminosity)
 *   λ_peak ≈ 2.9e-3 / T   (Wien displacement, m)
 *   v_orb(r) = sqrt(M/r)   (Keplerian, geometric units)
 */
export function AccretionDiskStudy({
  mass,
  spin,
  diskInner,
  diskOuter,
  className,
}: Props) {
  const r_s = 2 * mass;
  const r_isco = 6 * mass;

  // Sample T(r), F(r) across disk
  const profile = useMemo(() => {
    const arr: { r: number; T: number; F: number; v: number; lambda: number }[] = [];
    const rIn = diskInner * r_s;
    const rOut = diskOuter * r_s;
    const T0 = 1.0e7; // K, normalized for ~10 M☉ BH
    const sigma = 5.67e-8;
    for (let i = 0; i < 80; i++) {
      const r = rIn + ((rOut - rIn) * i) / 79;
      const cutoff = Math.pow(Math.max(1 - Math.sqrt(rIn / r), 0.001), 0.25);
      const T = T0 * Math.pow(r / r_s, -0.75) * cutoff;
      const F = sigma * Math.pow(T, 4);
      const v = Math.sqrt(mass / r);
      const lambda = (2.898e-3 / T) * 1e9; // nm
      arr.push({
        r: +(r / r_s).toFixed(2),
        T: +(T / 1e6).toFixed(3),
        F: +(F / 1e15).toFixed(3),
        v: +v.toFixed(3),
        lambda: +lambda.toFixed(2),
      });
    }
    return arr;
  }, [mass, diskInner, diskOuter, r_s]);

  // Bolometric luminosity (integrated)
  const luminosity = useMemo(() => {
    let L = 0;
    for (let i = 1; i < profile.length; i++) {
      const r1 = profile[i - 1].r * r_s;
      const r2 = profile[i].r * r_s;
      const F = (profile[i - 1].F + profile[i].F) * 0.5 * 1e15;
      L += 2 * Math.PI * ((r1 + r2) * 0.5) * F * (r2 - r1);
    }
    return L;
  }, [profile, r_s]);

  const Tmax = profile.reduce((m, p) => Math.max(m, p.T), 0);
  const lambdaMin = profile.reduce((m, p) => Math.min(m, p.lambda), 1e9);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="r_s" value={r_s.toFixed(3)} unit="GM/c²" tone="primary" />
        <Stat label="r_ISCO" value={r_isco.toFixed(3)} unit="GM/c²" tone="accent" />
        <Stat label="L_disk" value={(luminosity / 1e30).toExponential(2)} unit="× 10³⁰ W" tone="secondary" />
        <Stat label="T_max" value={Tmax.toFixed(2)} unit="MK" tone="destructive" />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {/* 3D disk visualization */}
        <div className="h-[280px] overflow-hidden rounded-lg border border-border bg-black">
          <Canvas
            gl={{ antialias: true, powerPreference: "high-performance" }}
            dpr={[1, 1.5]}
            camera={{ position: [0, 12, 22], fov: 50 }}
          >
            <color attach="background" args={["#02030a"]} />
            <ambientLight intensity={0.3} />
            <pointLight position={[0, 0, 0]} intensity={5} color="#ffaa55" distance={40} />
            <DiskMesh
              mass={mass}
              spin={spin}
              diskInner={diskInner}
              diskOuter={diskOuter}
            />
            <EventHorizon r_s={r_s} />
            <IscoRing r_isco={r_isco} />
            <OrbitControls
              enableDamping
              dampingFactor={0.08}
              minDistance={5}
              maxDistance={80}
              touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
            />
          </Canvas>
          <div className="pointer-events-none absolute mt-[-260px] ml-3">
            <Badge variant="outline" className="border-secondary/50 font-mono text-[10px] text-secondary">
              Thin-disk · Shakura-Sunyaev · spin a={spin.toFixed(2)}
            </Badge>
          </div>
        </div>

        {/* Profile graphs */}
        <div className="space-y-2">
          <ProfileGraph
            data={profile}
            yKey="T"
            label="T(r) — temperature"
            color="hsl(var(--destructive))"
            yLabel="MK"
          />
          <ProfileGraph
            data={profile}
            yKey="v"
            label="v_orb(r) / c — Keplerian"
            color="hsl(var(--primary))"
            yLabel="c"
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <ProfileGraph
          data={profile}
          yKey="F"
          label="F(r) — radiative flux (Stefan-Boltzmann)"
          color="hsl(var(--accent))"
          yLabel="× 10¹⁵ W/m²"
        />
        <ProfileGraph
          data={profile}
          yKey="lambda"
          label="λ_peak(r) — Wien displacement"
          color="hsl(var(--secondary))"
          yLabel="nm"
          marker={lambdaMin}
        />
      </div>

      <div className="rounded-md border border-border bg-muted/30 p-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
        <div className="mb-1 text-secondary">DISK PHYSICS</div>
        T(r) = T₀ (r/r_s)^(-3/4) [1 − √(r_in/r)]^(1/4)<br />
        F(r) = σT⁴ &nbsp;·&nbsp; L = ∫ 2π r F(r) dr<br />
        λ_peak = 2.898e-3 / T (Wien) — peak emission wavelength<br />
        v_orb = √(GM/r) — Keplerian (geometric units, c=1)<br />
        Inner edge clipped at ISCO (r=6M, Schwarzschild). Spin a={spin.toFixed(2)} → prograde ISCO would shrink toward r=M.
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  tone: "primary" | "accent" | "secondary" | "destructive";
}) {
  const toneClass = {
    primary: "border-primary/40 text-primary",
    accent: "border-accent/40 text-accent",
    secondary: "border-secondary/40 text-secondary",
    destructive: "border-destructive/40 text-destructive",
  }[tone];
  return (
    <div className={cn("rounded-md border bg-card/40 px-3 py-2", toneClass)}>
      <div className="font-mono text-[9px] uppercase tracking-widest opacity-70">{label}</div>
      <div className="font-mono text-sm font-bold">{value}</div>
      <div className="font-mono text-[9px] opacity-60">{unit}</div>
    </div>
  );
}

function ProfileGraph({
  data,
  yKey,
  label,
  color,
  yLabel,
  marker,
}: {
  data: { r: number; T: number; F: number; v: number; lambda: number }[];
  yKey: "T" | "F" | "v" | "lambda";
  label: string;
  color: string;
  yLabel: string;
  marker?: number;
}) {
  return (
    <div className="rounded-md border border-border bg-card/40 p-2">
      <div className="mb-1 px-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="h-[140px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
            <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" />
            <XAxis
              dataKey="r"
              tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
              label={{ value: "r / r_s", fontSize: 9, fill: "hsl(var(--muted-foreground))", position: "insideBottom", offset: -2 }}
            />
            <YAxis
              tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
              label={{ value: yLabel, fontSize: 9, fill: "hsl(var(--muted-foreground))", angle: -90, position: "insideLeft" }}
            />
            <Tooltip
              contentStyle={{
                background: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                fontSize: 10,
                fontFamily: "monospace",
              }}
            />
            {marker !== undefined && (
              <ReferenceLine y={marker} stroke="hsl(var(--accent))" strokeDasharray="3 3" />
            )}
            <Line type="monotone" dataKey={yKey} stroke={color} strokeWidth={1.6} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function DiskMesh({
  mass,
  spin,
  diskInner,
  diskOuter,
}: {
  mass: number;
  spin: number;
  diskInner: number;
  diskOuter: number;
}) {
  const ref = useRef<THREE.Mesh>(null);
  const r_s = 2 * mass;
  const rIn = diskInner * r_s;
  const rOut = diskOuter * r_s;

  const { geom, colors } = useMemo(() => {
    const g = new THREE.RingGeometry(rIn, rOut, 128, 32);
    const pos = g.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const r = Math.sqrt(x * x + y * y);
      // T ∝ r^(-3/4)
      const T = Math.pow(r / r_s, -0.75);
      const k = Math.min(1, T * 0.7);
      // hot core white-blue → mid orange → outer red
      cols[i * 3 + 0] = 0.4 + k * 0.6;
      cols[i * 3 + 1] = 0.2 + k * 0.6;
      cols[i * 3 + 2] = 0.05 + k * 0.9;
    }
    g.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    g.rotateX(-Math.PI / 2);
    return { geom: g, colors: cols };
  }, [rIn, rOut, r_s]);

  useFrame((s) => {
    if (!ref.current) return;
    ref.current.rotation.y = s.clock.elapsedTime * 0.4 * (1 + spin);
  });

  return (
    <mesh ref={ref} geometry={geom}>
      <meshBasicMaterial vertexColors side={THREE.DoubleSide} transparent opacity={0.92} />
    </mesh>
  );
}

function EventHorizon({ r_s }: { r_s: number }) {
  return (
    <mesh>
      <sphereGeometry args={[r_s, 32, 32]} />
      <meshBasicMaterial color="#000" />
    </mesh>
  );
}

function IscoRing({ r_isco }: { r_isco: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[r_isco * 0.99, r_isco * 1.01, 64]} />
      <meshBasicMaterial color="#00ffaa" side={THREE.DoubleSide} transparent opacity={0.7} />
    </mesh>
  );
}
