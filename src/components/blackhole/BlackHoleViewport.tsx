import { useCallback, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { Canvas } from "@react-three/fiber";
import { BlackHoleQuad, type BlackHoleParams } from "./BlackHoleQuad";
import { StreamlineOverlay } from "./StreamlineOverlay";
import { cn } from "@/lib/utils";

interface Props {
  params: BlackHoleParams;
  label: string;
  sublabel?: string;
  badge?: string;
  className?: string;
  onClick?: () => void;
  active?: boolean;
  /** show fluid streamline overlay (default true). */
  streamlines?: boolean;
}

/**
 * Black hole viewport.
 *
 * Touch + mouse interaction (mutates the live `params` object so the shader
 * picks the change up on its next useFrame tick — no React re-render needed):
 *   • 1-finger drag / mouse drag → orbit (azimuth + elevation)
 *   • 2-finger pinch / wheel     → dolly (cameraDistance)
 *   • tap (no drag)              → fires onClick for selection
 *
 * Also overlays animated fluid-dynamics streamlines that spiral around the
 * disk to visualize accretion + frame-dragging without raymarcher cost.
 */
export function BlackHoleViewport({
  params,
  label,
  sublabel,
  badge,
  className,
  onClick,
  active,
  streamlines = true,
}: Props) {
  const [interacting, setInteracting] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastSingle = useRef<{ x: number; y: number } | null>(null);
  const lastPinchDist = useRef<number | null>(null);
  const dragMoved = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const stopAuto = useCallback(() => {
    params.autoRotate = false;
  }, [params]);

  const onPointerDown = useCallback(
    (e: RPointerEvent<HTMLDivElement>) => {
      containerRef.current?.setPointerCapture(e.pointerId);
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      dragMoved.current = false;
      if (pointers.current.size === 1) {
        lastSingle.current = { x: e.clientX, y: e.clientY };
        lastPinchDist.current = null;
      } else if (pointers.current.size === 2) {
        const [a, b] = Array.from(pointers.current.values());
        lastPinchDist.current = Math.hypot(a.x - b.x, a.y - b.y);
        lastSingle.current = null;
      }
      setInteracting(true);
      stopAuto();
    },
    [stopAuto],
  );

  const onPointerMove = useCallback(
    (e: RPointerEvent<HTMLDivElement>) => {
      if (!pointers.current.has(e.pointerId)) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.current.size === 1 && lastSingle.current) {
        const dx = e.clientX - lastSingle.current.x;
        const dy = e.clientY - lastSingle.current.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved.current = true;
        const rect = containerRef.current?.getBoundingClientRect();
        const w = rect?.width ?? 400;
        const h = rect?.height ?? 400;
        params.cameraOrbit -= (dx / w) * Math.PI * 1.4;
        params.cameraElevation = Math.max(
          -1.45,
          Math.min(1.45, params.cameraElevation + (dy / h) * Math.PI * 0.9),
        );
        lastSingle.current = { x: e.clientX, y: e.clientY };
      } else if (pointers.current.size === 2 && lastPinchDist.current !== null) {
        const [a, b] = Array.from(pointers.current.values());
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const ratio = lastPinchDist.current / Math.max(1, dist);
        params.cameraDistance = Math.max(
          6,
          Math.min(120, params.cameraDistance * ratio),
        );
        lastPinchDist.current = dist;
        dragMoved.current = true;
      }
    },
    [params],
  );

  const onPointerUp = useCallback(
    (e: RPointerEvent<HTMLDivElement>) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) lastPinchDist.current = null;
      if (pointers.current.size < 1) {
        lastSingle.current = null;
        setInteracting(false);
        if (!dragMoved.current && onClick) onClick();
      } else {
        const [first] = Array.from(pointers.current.values());
        lastSingle.current = { ...first };
      }
    },
    [onClick],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const factor = Math.exp(e.deltaY * 0.0015);
      params.cameraDistance = Math.max(
        6,
        Math.min(120, params.cameraDistance * factor),
      );
      stopAuto();
    },
    [params, stopAuto],
  );

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      className={cn(
        "relative touch-none select-none overflow-hidden rounded-lg border bg-black transition-all",
        active
          ? "border-primary shadow-[0_0_30px_hsl(var(--primary)/0.4)]"
          : "border-border hover:border-primary/40",
        onClick && "cursor-grab",
        interacting && "cursor-grabbing",
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

      {streamlines && (
        <StreamlineOverlay
          spin={params.spin}
          frameDrag={params.frameDrag}
          tilt={params.diskTilt}
          intensity={interacting ? 1 : 0.75}
        />
      )}

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

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-black/60 to-transparent p-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground/80">
          drag · pinch · scroll
        </span>
      </div>
    </div>
  );
}
