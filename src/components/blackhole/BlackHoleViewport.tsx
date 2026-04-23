import { Canvas } from "@react-three/fiber";
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
