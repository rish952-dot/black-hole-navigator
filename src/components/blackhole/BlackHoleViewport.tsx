import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { BlackHoleQuad, type BlackHoleParams } from "./BlackHoleQuad";
import { cn } from "@/lib/utils";

interface Props {
  params: BlackHoleParams;
  label: string;
  sublabel?: string;
  badge?: string;
  className?: string;
  onClick?: () => void;
  active?: boolean;
}

/**
 * Black hole viewport. The shader is a fullscreen quad that handles its own
 * camera, but we still mount OrbitControls so touch + mouse gestures register
 * (the shader reads orbit/elevation params separately, so we leave camera
 * untouched here — touch gestures are absorbed without affecting the
 * raymarched scene). To enable interactive orbit on this view, wire its
 * onChange to update params.cameraOrbit/Elevation.
 */
export function BlackHoleViewport({
  params,
  label,
  sublabel,
  badge,
  className,
  onClick,
  active,
}: Props) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "relative overflow-hidden rounded-lg border bg-black transition-all",
        active
          ? "border-primary shadow-[0_0_30px_hsl(var(--primary)/0.4)]"
          : "border-border hover:border-primary/40",
        onClick && "cursor-pointer",
        className,
      )}
    >
      <Canvas
        gl={{ antialias: false, powerPreference: "high-performance" }}
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 5], fov: 50 }}
      >
        <BlackHoleQuad params={params} />
        <OrbitControls
          enableDamping
          enableZoom={false}
          enablePan={false}
          touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        />
      </Canvas>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between bg-gradient-to-b from-black/70 to-transparent p-3">
        <div>
          <div className="text-xs font-mono uppercase tracking-widest text-primary">
            {label}
          </div>
          {sublabel && (
            <div className="text-[10px] font-mono text-muted-foreground">
              {sublabel}
            </div>
          )}
        </div>
        {badge && (
          <span className="rounded border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] uppercase text-primary">
            {badge}
          </span>
        )}
      </div>
    </div>
  );
}
