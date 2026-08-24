import { useEffect, useMemo, useRef, useState } from "react";
import { createDefaultDepartmentMesh, type DepartmentId } from "@/farm/department-mesh";

type Point = { x: number; y: number; vx: number; vy: number };
type RuntimeNode = Point & { id: DepartmentId; health: number; load: number; pulse: number };

const NODE_RADIUS = 8;
const MAX_DPR = 1.5;
const TICK_MS = 1000;

const nodeNames: Record<DepartmentId, string> = {
  "central-mind": "CENTRAL MIND",
  hive: "HIVE",
  ai: "AI",
  jobs: "JOBS",
  execution: "EXECUTION",
  evolution: "EVOLUTION",
  finance: "FINANCE",
  backend: "BACKEND",
  observability: "OBSERVABILITY",
};

function seeded(index: number) {
  const value = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export default function LiveMeshNetwork() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const resizeRef = useRef<ResizeObserver | null>(null);
  const runtimeRef = useRef<RuntimeNode[]>([]);
  const activityRef = useRef(0);
  const [fps, setFps] = useState(60);
  const [tick, setTick] = useState(0);

  const topology = useMemo(() => {
    const mesh = createDefaultDepartmentMesh();
    const ids = Object.keys(mesh.snapshot()) as DepartmentId[];
    return {
      ids,
      links: ids.flatMap((id) =>
        mesh.neighbors(id).map((to) => ({ a: id, b: to })),
      ).filter((link, index, links) => {
        const key = [link.a, link.b].sort().join("|");
        return links.findIndex((other) => [other.a, other.b].sort().join("|") === key) === index;
      }),
      neighbors: mesh.snapshot(),
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const setup = () => {
      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };

    setup();
    resizeRef.current = new ResizeObserver(setup);
    resizeRef.current.observe(parent);

    const existing = runtimeRef.current;
    if (existing.length !== topology.ids.length) {
      runtimeRef.current = topology.ids.map((id, index) => ({
        id,
        x: 0.5 + (seeded(index + 1) - 0.5) * 0.5,
        y: 0.5 + (seeded(index + 31) - 0.5) * 0.5,
        vx: 0,
        vy: 0,
        health: 0.75 + seeded(index + 50) * 0.25,
        load: 0.2 + seeded(index + 90) * 0.6,
        pulse: seeded(index + 120) * Math.PI * 2,
      }));
    }

    let last = performance.now();
    let frames = 0;
    let fpsStamp = last;

    const draw = (now: number) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const nodes = runtimeRef.current;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const dt = Math.min(0.033, Math.max(0.001, (now - last) / 1000));
      last = now;

      ctx.setTransform(canvas.width / Math.max(1, width), 0, 0, canvas.height / Math.max(1, height), 0, 0);
      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height / 2;
      const scale = Math.min(width, height);
      const nodeMap = new Map(nodes.map((node) => [node.id, node]));

      // CPU force simulation: spring edges + center gravity + node repulsion.
      for (const node of nodes) {
        let fx = (0.5 - node.x) * 0.28;
        let fy = (0.5 - node.y) * 0.28;

        if (node.id !== "central-mind") {
          const radius = 0.23 + node.load * 0.08;
          fx += (0.5 - node.x) * (radius - Math.hypot(node.x - 0.5, node.y - 0.5)) * 0.7;
          fy += (0.5 - node.y) * (radius - Math.hypot(node.x - 0.5, node.y - 0.5)) * 0.7;
        }

        for (const other of nodes) {
          if (other === node) continue;
          const dx = node.x - other.x;
          const dy = node.y - other.y;
          const dist2 = Math.max(0.0004, dx * dx + dy * dy);
          if (dist2 < 0.06) {
            const force = 0.0007 / dist2;
            fx += dx * force;
            fy += dy * force;
          }
        }

        for (const link of topology.links) {
          if (link.a !== node.id && link.b !== node.id) continue;
          const otherId = link.a === node.id ? link.b : link.a;
          const other = nodeMap.get(otherId);
          if (!other) continue;
          const dx = other.x - node.x;
          const dy = other.y - node.y;
          const dist = Math.max(0.0001, Math.hypot(dx, dy));
          const target = otherId === "central-mind" || node.id === "central-mind" ? 0.22 : 0.16;
          const force = (dist - target) * 0.45;
          fx += (dx / dist) * force;
          fy += (dy / dist) * force;
        }

        node.vx = (node.vx + fx * dt) * 0.92;
        node.vy = (node.vy + fy * dt) * 0.92;
        node.x = Math.min(0.94, Math.max(0.06, node.x + node.vx * dt));
        node.y = Math.min(0.94, Math.max(0.06, node.y + node.vy * dt));
      }

      activityRef.current += dt;
      if (activityRef.current > TICK_MS / 1000) {
        activityRef.current = 0;
        for (const node of nodes) {
          const wave = Math.sin(now * 0.001 + node.pulse);
          node.load = Math.min(1, Math.max(0, node.load + wave * 0.035));
          node.health = Math.min(1, Math.max(0.25, node.health + Math.sin(now * 0.0007 + node.pulse) * 0.012));
        }
        setTick((value) => value + 1);
      }

      // HUD-style background grid.
      ctx.strokeStyle = "rgba(59,130,246,0.10)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 12; i++) {
        const x = (width / 12) * i;
        const y = (height / 12) * i;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }

      // Render edges.
      for (const link of topology.links) {
        const a = nodeMap.get(link.a);
        const b = nodeMap.get(link.b);
        if (!a || !b) continue;
        const ax = a.x * width;
        const ay = a.y * height;
        const bx = b.x * width;
        const by = b.y * height;
        const energy = (a.load + b.load) / 2;
        ctx.strokeStyle = `rgba(80,180,255,${0.16 + energy * 0.48})`;
        ctx.lineWidth = 1 + energy * 1.2;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();

        if (energy > 0.65) {
          const phase = (now * 0.0015 + a.pulse) % 1;
          const px = ax + (bx - ax) * phase;
          const py = ay + (by - ay) * phase;
          ctx.fillStyle = "rgba(160,230,255,0.9)";
          ctx.beginPath(); ctx.arc(px, py, 2, 0, Math.PI * 2); ctx.fill();
        }
      }

      // Central mind halo.
      const mind = nodeMap.get("central-mind");
      if (mind) {
        const mx = mind.x * width;
        const my = mind.y * height;
        const pulse = 18 + Math.sin(now * 0.004) * 4;
        const gradient = ctx.createRadialGradient(mx, my, 2, mx, my, pulse * 2.5);
        gradient.addColorStop(0, "rgba(96,165,250,0.40)");
        gradient.addColorStop(1, "rgba(96,165,250,0)");
        ctx.fillStyle = gradient;
        ctx.beginPath(); ctx.arc(mx, my, pulse * 2.5, 0, Math.PI * 2); ctx.fill();
      }

      // Nodes and labels.
      for (const node of nodes) {
        const x = node.x * width;
        const y = node.y * height;
        const r = NODE_RADIUS + node.load * 4 + Math.sin(now * 0.003 + node.pulse) * 1.5;
        ctx.fillStyle = node.id === "central-mind" ? "rgba(120,210,255,1)" : "rgba(66,170,255,0.92)";
        ctx.shadowColor = "rgba(60,160,255,0.75)";
        ctx.shadowBlur = node.id === "central-mind" ? 20 : 10;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;

        ctx.fillStyle = "rgba(218,238,255,0.88)";
        ctx.font = node.id === "central-mind" ? "600 12px ui-monospace, monospace" : "500 10px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(nodeNames[node.id], x, y + r + 15);
      }

      frames += 1;
      if (now - fpsStamp > 1000) {
        setFps(Math.round((frames * 1000) / (now - fpsStamp)));
        frames = 0;
        fpsStamp = now;
      }

      frameRef.current = requestAnimationFrame(draw);
    };

    frameRef.current = requestAnimationFrame(draw);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      resizeRef.current?.disconnect();
    };
  }, [topology]);

  const healthy = runtimeRef.current.filter((node) => node.health > 0.6).length;
  const avgLoad = runtimeRef.current.length
    ? runtimeRef.current.reduce((sum, node) => sum + node.load, 0) / runtimeRef.current.length
    : 0;

  return (
    <section className="relative h-full w-full overflow-hidden rounded-xl border border-blue-400/20 bg-black/70 font-mono">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-label="Live CPU-rendered mesh network" />
      <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-3 text-[10px] uppercase tracking-[0.16em] text-blue-100/80 md:text-xs">
        <div>
          <div className="text-blue-100">JARVIS // LIVE MESH</div>
          <div className="text-blue-300/60">CPU topology renderer · adaptive force field</div>
        </div>
        <div className="text-right">
          <div>FPS {fps}</div>
          <div>LINKS {topology.links.length}</div>
          <div>HEALTHY {healthy}/{runtimeRef.current.length}</div>
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 rounded border border-blue-400/20 bg-black/45 px-3 py-2 text-[10px] text-blue-100/70">
        <div>LOAD {(avgLoad * 100).toFixed(0)}%</div>
        <div>NETWORK TICK {tick}</div>
        <div>DEPARTMENTS {topology.ids.length}</div>
      </div>
    </section>
  );
}
