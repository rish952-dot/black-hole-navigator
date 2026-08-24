import { useEffect, useMemo, useRef, useState } from "react";
import { createDefaultDepartmentMesh, type DepartmentId } from "@/farm/department-mesh";

type Point = { x: number; y: number; vx: number; vy: number };
type RuntimeNode = Point & {
  id: DepartmentId;
  health: number;
  load: number;
  confidence: number;
  novelty: number;
  urgency: number;
  strategy: number[];
  pulse: number;
  active: boolean;
};

type ViewMode = "mesh" | "4d" | "debug";

const NODE_RADIUS = 7;
const MAX_DPR = 1.5;
const TICK_MS = 550;
const DEPARTMENTS: DepartmentId[] = [
  "central-mind",
  "hive",
  "ai",
  "jobs",
  "execution",
  "evolution",
  "finance",
  "backend",
  "observability",
];

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

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function buildRuntime(index: number, id: DepartmentId): RuntimeNode {
  const base = seeded(index + 1);
  return {
    id,
    x: 0.5 + (seeded(index + 10) - 0.5) * 0.5,
    y: 0.5 + (seeded(index + 30) - 0.5) * 0.5,
    vx: 0,
    vy: 0,
    health: 0.72 + base * 0.28,
    load: 0.18 + seeded(index + 50) * 0.58,
    confidence: 0.58 + seeded(index + 70) * 0.4,
    novelty: seeded(index + 90),
    urgency: 0.15 + seeded(index + 110) * 0.8,
    strategy: [seeded(index + 130), seeded(index + 150), seeded(index + 170)],
    pulse: seeded(index + 190) * Math.PI * 2,
    active: false,
  };
}

export default function LiveMeshNetwork() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const resizeRef = useRef<ResizeObserver | null>(null);
  const runtimeRef = useRef<RuntimeNode[]>([]);
  const selectedRef = useRef<DepartmentId | null>(null);
  const tickRef = useRef(0);
  const [fps, setFps] = useState(60);
  const [tick, setTick] = useState(0);
  const [selected, setSelected] = useState<DepartmentId | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("mesh");
  const [broken, setBroken] = useState(0);
  const [connectionActivity, setConnectionActivity] = useState(0);

  const topology = useMemo(() => {
    const mesh = createDefaultDepartmentMesh();
    const snapshot = mesh.snapshot();
    const links = DEPARTMENTS.flatMap((id) =>
      mesh.neighbors(id).map((to) => ({ a: id, b: to })),
    ).filter((link, index, links) => {
      const key = [link.a, link.b].sort().join("|");
      return links.findIndex((other) => [other.a, other.b].sort().join("|") === key) === index;
    });
    return { ids: DEPARTMENTS, links, neighbors: snapshot };
  }, []);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

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

    runtimeRef.current = topology.ids.map((id, index) => buildRuntime(index, id));

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

      const nodeMap = new Map(nodes.map((node) => [node.id, node]));

      // Live CPU force field: edges attract, nodes repel, Central Mind anchors the network.
      for (const node of nodes) {
        let fx = (0.5 - node.x) * 0.24;
        let fy = (0.5 - node.y) * 0.24;

        if (node.id !== "central-mind") {
          const targetRadius = 0.19 + node.load * 0.10 + node.urgency * 0.025;
          const radius = Math.hypot(node.x - 0.5, node.y - 0.5);
          const radial = (targetRadius - radius) * 0.85;
          const nx = (0.5 - node.x) / Math.max(0.0001, radius);
          const ny = (0.5 - node.y) / Math.max(0.0001, radius);
          fx += nx * radial;
          fy += ny * radial;
        }

        for (const other of nodes) {
          if (other === node) continue;
          const dx = node.x - other.x;
          const dy = node.y - other.y;
          const dist2 = Math.max(0.00055, dx * dx + dy * dy);
          if (dist2 < 0.08) {
            const force = (0.0009 * (1 + node.novelty * 0.6)) / dist2;
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
          const target = node.id === "central-mind" || otherId === "central-mind" ? 0.205 : 0.14;
          const strength = 0.36 + ((node.confidence + other.confidence) * 0.14);
          const force = (dist - target) * strength;
          fx += (dx / dist) * force;
          fy += (dy / dist) * force;
        }

        const selectedBoost = selectedRef.current === node.id ? 1.35 : 1;
        node.vx = (node.vx + fx * dt * selectedBoost) * 0.90;
        node.vy = (node.vy + fy * dt * selectedBoost) * 0.90;
        node.x = Math.min(0.95, Math.max(0.05, node.x + node.vx * dt));
        node.y = Math.min(0.95, Math.max(0.05, node.y + node.vy * dt));
      }

      tickRef.current += dt * 1000;
      if (tickRef.current >= TICK_MS) {
        tickRef.current = 0;
        let activeCount = 0;
        for (const node of nodes) {
          const wave = Math.sin(now * (0.001 + node.novelty * 0.001) + node.pulse);
          const strategyEnergy = node.strategy.reduce((sum, value) => sum + value, 0) / node.strategy.length;
          node.load = clamp01(node.load + wave * 0.045 + (node.urgency - 0.5) * 0.015);
          node.health = clamp01(node.health + Math.sin(now * 0.00065 + node.pulse) * 0.009);
          node.active = node.load > 0.56 || node.urgency > 0.72 || strategyEnergy > 0.68;
          if (node.active) activeCount++;
        }

        const activeLinks = topology.links.filter((link) => {
          const a = nodeMap.get(link.a)!;
          const b = nodeMap.get(link.b)!;
          return a.active || b.active;
        }).length;
        setConnectionActivity(activeLinks);
        setBroken(nodes.filter((node) => node.health < 0.45).length);
        setTick((value) => value + 1);
        setConnectionActivity(Math.max(activeCount, activeLinks));
      }

      const gridAlpha = viewMode === "debug" ? 0.16 : 0.08;
      ctx.strokeStyle = `rgba(72,140,255,${gridAlpha})`;
      ctx.lineWidth = 1;
      for (let i = 1; i < 12; i++) {
        const x = (width / 12) * i;
        const y = (height / 12) * i;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }

      // Mesh edges with activity-dependent intensity.
      for (const link of topology.links) {
        const a = nodeMap.get(link.a);
        const b = nodeMap.get(link.b);
        if (!a || !b) continue;
        const ax = a.x * width;
        const ay = a.y * height;
        const bx = b.x * width;
        const by = b.y * height;
        const energy = clamp01((a.load + b.load + a.urgency + b.urgency) / 4);
        const selectedLink = selectedRef.current === a.id || selectedRef.current === b.id;
        const alpha = selectedLink ? 0.84 : 0.16 + energy * 0.52;
        ctx.strokeStyle = viewMode === "debug"
          ? `rgba(${energy > 0.7 ? 255 : 100},${energy > 0.7 ? 90 : 200},${energy > 0.7 ? 90 : 255},${alpha})`
          : `rgba(90,190,255,${alpha})`;
        ctx.lineWidth = selectedLink ? 2 : 0.8 + energy * 1.3;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();

        if (energy > 0.52) {
          const phase = ((now * (0.0011 + energy * 0.0014) + a.pulse * 1000) % 1000) / 1000;
          const px = ax + (bx - ax) * phase;
          const py = ay + (by - ay) * phase;
          ctx.fillStyle = "rgba(190,240,255,0.92)";
          ctx.beginPath(); ctx.arc(px, py, selectedLink ? 3 : 2, 0, Math.PI * 2); ctx.fill();
        }
      }

      const mind = nodeMap.get("central-mind");
      if (mind) {
        const mx = mind.x * width;
        const my = mind.y * height;
        const pulse = 20 + Math.sin(now * 0.004) * 5 + mind.load * 6;
        const gradient = ctx.createRadialGradient(mx, my, 2, mx, my, pulse * 3);
        gradient.addColorStop(0, "rgba(120,220,255,0.55)");
        gradient.addColorStop(0.35, "rgba(90,180,255,0.20)");
        gradient.addColorStop(1, "rgba(90,180,255,0)");
        ctx.fillStyle = gradient;
        ctx.beginPath(); ctx.arc(mx, my, pulse * 3, 0, Math.PI * 2); ctx.fill();
      }

      // Nodes + live role labels.
      for (const node of nodes) {
        const x = node.x * width;
        const y = node.y * height;
        const selectedNode = selectedRef.current === node.id;
        const r = NODE_RADIUS + node.load * 5 + (selectedNode ? 4 : 0) + Math.sin(now * 0.003 + node.pulse) * 1.2;
        const healthTint = node.health < 0.5 ? "rgba(255,95,110,0.95)" : node.id === "central-mind" ? "rgba(120,225,255,1)" : "rgba(74,176,255,0.94)";

        if (node.active || selectedNode) {
          ctx.strokeStyle = selectedNode ? "rgba(225,245,255,0.95)" : "rgba(110,225,255,0.50)";
          ctx.lineWidth = selectedNode ? 2 : 1;
          ctx.beginPath(); ctx.arc(x, y, r + 5 + Math.sin(now * 0.005 + node.pulse) * 2, 0, Math.PI * 2); ctx.stroke();
        }

        ctx.fillStyle = healthTint;
        ctx.shadowColor = healthTint;
        ctx.shadowBlur = node.id === "central-mind" ? 26 : 12;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;

        if (selectedNode || viewMode !== "mesh") {
          ctx.fillStyle = "rgba(222,240,255,0.92)";
          ctx.font = selectedNode ? "600 12px ui-monospace, monospace" : "500 9px ui-monospace, monospace";
          ctx.textAlign = "center";
          ctx.fillText(nodeNames[node.id], x, y + r + 15);
        }
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
  }, [topology, viewMode]);

  const healthy = runtimeRef.current.filter((node) => node.health > 0.6).length;
  const avgLoad = runtimeRef.current.length
    ? runtimeRef.current.reduce((sum, node) => sum + node.load, 0) / runtimeRef.current.length
    : 0;
  const selectedNode = runtimeRef.current.find((node) => node.id === selected) ?? null;
  const activeNodes = runtimeRef.current.filter((node) => node.active).length;

  const selectNext = () => {
    const index = selected ? topology.ids.indexOf(selected) : -1;
    const next = topology.ids[(index + 1) % topology.ids.length];
    setSelected(next);
  };

  return (
    <section className="relative h-full w-full overflow-hidden rounded-xl border border-cyan-400/20 bg-black font-mono">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full cursor-crosshair"
        aria-label="Live CPU-rendered department mesh"
        onClick={selectNext}
      />

      <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-3 md:inset-x-5 md:top-4">
        <div className="rounded border border-cyan-400/30 bg-black/70 px-3 py-2 backdrop-blur-sm">
          <div className="text-xs font-semibold tracking-[0.18em] text-cyan-100">JARVIS // LIVE MESH</div>
          <div className="mt-1 text-[9px] uppercase tracking-[0.15em] text-cyan-300/55">Central Mind · Department Mesh · CPU topology</div>
        </div>
        <div className="rounded border border-cyan-400/20 bg-black/70 px-3 py-2 text-right text-[9px] uppercase leading-5 text-cyan-100/80 backdrop-blur-sm">
          <div>FPS {fps}</div>
          <div>NODES {topology.ids.length}</div>
          <div>LINKS {topology.links.length}</div>
        </div>
      </div>

      <div className="pointer-events-none absolute left-3 right-3 top-20 flex flex-col gap-2 md:left-5 md:right-5 md:top-24 md:max-w-sm">
        <div className="flex items-center justify-between rounded border border-cyan-400/20 bg-black/65 px-3 py-2 text-[10px] text-cyan-100/80 backdrop-blur-sm">
          <span>TAPESTRY · {topology.ids.length} DEPARTMENTS</span>
          <span className={broken ? "text-red-300" : "text-cyan-200"}>{broken ? `${broken} DEGRADED` : "ALL LINKS NOMINAL"}</span>
        </div>
        <div className="flex items-center justify-between rounded border border-cyan-400/15 bg-black/60 px-3 py-2 text-[10px] text-cyan-100/65">
          <span>LOAD {(avgLoad * 100).toFixed(0)}% · ACTIVE {activeNodes}</span>
          <span>TICK {tick}</span>
        </div>
      </div>

      <div className="pointer-events-none absolute right-3 top-36 rounded border border-orange-300/20 bg-black/65 px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-orange-100/75 backdrop-blur-sm md:right-5 md:top-40">
        <span className="mr-2">⚡</span> LIVE
      </div>

      <div className="absolute bottom-3 left-3 right-3 rounded-xl border border-cyan-400/15 bg-black/65 p-3 backdrop-blur-md md:bottom-5 md:left-5 md:right-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex gap-1 rounded-lg border border-cyan-400/10 bg-black/45 p-1">
            {(["mesh", "4d", "debug"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`rounded-md px-3 py-1.5 text-[10px] uppercase tracking-[0.12em] transition ${
                  viewMode === mode
                    ? "bg-cyan-500/25 text-cyan-100 shadow-[0_0_18px_rgba(34,211,238,0.18)]"
                    : "text-cyan-100/45 hover:text-cyan-100/80"
                }`}
                onClick={() => setViewMode(mode)}
              >
                {mode === "4d" ? "4D" : mode}
              </button>
            ))}
          </div>
          <button type="button" onClick={selectNext} className="rounded border border-cyan-400/20 px-3 py-1.5 text-[10px] uppercase text-cyan-100/65 hover:text-cyan-100">
            Next node
          </button>
        </div>

        <div className="rounded-lg border border-cyan-400/10 bg-black/45 p-3">
          {selectedNode ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[10px] text-cyan-100/75 md:grid-cols-4">
              <div><div className="text-cyan-300/45">NODE</div><div>{nodeNames[selectedNode.id]}</div></div>
              <div><div className="text-cyan-300/45">HEALTH</div><div>{(selectedNode.health * 100).toFixed(0)}%</div></div>
              <div><div className="text-cyan-300/45">LOAD</div><div>{(selectedNode.load * 100).toFixed(0)}%</div></div>
              <div><div className="text-cyan-300/45">VECTOR</div><div>{selectedNode.confidence.toFixed(2)} / {selectedNode.novelty.toFixed(2)} / {selectedNode.urgency.toFixed(2)}</div></div>
            </div>
          ) : (
            <div className="text-xs leading-6 text-cyan-100/65">
              <div className="text-cyan-200">NODE INSPECTOR</div>
              <div>Tap the live mesh to inspect a department. The topology continuously shifts with simulated load, urgency, confidence and strategy vectors.</div>
            </div>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between text-[9px] uppercase tracking-[0.12em] text-cyan-100/45">
          <span>HEALTHY {healthy}/{runtimeRef.current.length}</span>
          <span>LINK ACTIVITY {connectionActivity}</span>
          <span>CPU RENDER</span>
        </div>
      </div>
    </section>
  );
}
