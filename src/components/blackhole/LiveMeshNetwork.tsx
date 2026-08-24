import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { createDefaultDepartmentMesh, type DepartmentId } from "@/farm/department-mesh";

type Node = { id: DepartmentId; x: number; y: number; vx: number; vy: number; load: number; health: number; phase: number };

const ids: DepartmentId[] = ["central-mind", "hive", "ai", "jobs", "execution", "evolution", "finance", "backend", "observability"];
const names: Record<DepartmentId, string> = {
  "central-mind": "CENTRAL MIND", hive: "HIVE", ai: "AI", jobs: "JOBS", execution: "EXECUTION",
  evolution: "EVOLUTION", finance: "FINANCE", backend: "BACKEND", observability: "OBSERVABILITY",
};
const rnd = (n: number) => { const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

export default function LiveMeshNetwork() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Node[]>([]);
  const selectedRef = useRef<DepartmentId | null>(null);
  const pausedRef = useRef(false);
  const [selected, setSelected] = useState<DepartmentId | null>(null);
  const [fps, setFps] = useState(60);
  const [tick, setTick] = useState(0);
  const [paused, setPaused] = useState(false);

  const topology = useMemo(() => {
    const mesh = createDefaultDepartmentMesh();
    const links: { a: DepartmentId; b: DepartmentId }[] = [];
    const seen = new Set<string>();
    for (const a of ids) for (const b of mesh.neighbors(a)) {
      const key = [a, b].sort().join("|");
      if (!seen.has(key)) { seen.add(key); links.push({ a, b }); }
    }
    return { links };
  }, []);

  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const r = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.floor(r.width * dpr));
      canvas.height = Math.max(1, Math.floor(r.height * dpr));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(parent);

    nodesRef.current = ids.map((id, i) => ({
      id, x: .5 + (rnd(i + 1) - .5) * .45, y: .5 + (rnd(i + 31) - .5) * .45,
      vx: 0, vy: 0, load: .2 + rnd(i + 51) * .6, health: .85 + rnd(i + 71) * .15, phase: rnd(i + 91) * Math.PI * 2,
    }));

    let raf = 0, last = performance.now(), frames = 0, fpsAt = last, elapsed = 0;
    const draw = (now: number) => {
      const dt = Math.min(.033, Math.max(.001, (now - last) / 1000));
      last = now;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      ctx.setTransform(canvas.width / Math.max(1, w), 0, 0, canvas.height / Math.max(1, h), 0, 0);
      ctx.clearRect(0, 0, w, h);
      const nodes = nodesRef.current;
      const map = new Map(nodes.map(n => [n.id, n]));

      if (!pausedRef.current) {
        for (const n of nodes) {
          let fx = (.5 - n.x) * .25, fy = (.5 - n.y) * .25;
          for (const o of nodes) if (o !== n) {
            const dx = n.x - o.x, dy = n.y - o.y, d2 = Math.max(.0008, dx * dx + dy * dy);
            if (d2 < .055) { const f = .00055 / d2; fx += dx * f; fy += dy * f; }
          }
          for (const e of topology.links) if (e.a === n.id || e.b === n.id) {
            const o = map.get(e.a === n.id ? e.b : e.a)!;
            const dx = o.x - n.x, dy = o.y - n.y, d = Math.max(.0001, Math.hypot(dx, dy));
            const target = n.id === "central-mind" || o.id === "central-mind" ? .21 : .15;
            const f = (d - target) * .32;
            fx += dx / d * f; fy += dy / d * f;
          }
          n.vx = (n.vx + fx * dt) * .91; n.vy = (n.vy + fy * dt) * .91;
          n.x = Math.max(.06, Math.min(.94, n.x + n.vx * dt)); n.y = Math.max(.08, Math.min(.92, n.y + n.vy * dt));
          n.load = Math.max(.05, Math.min(.98, n.load + Math.sin(now * .001 + n.phase) * .0015));
        }
        elapsed += dt;
        if (elapsed > .5) { elapsed = 0; setTick(v => v + 1); }
      }

      ctx.strokeStyle = "rgba(70,170,255,.18)"; ctx.lineWidth = 1;
      for (const e of topology.links) {
        const a = map.get(e.a)!, b = map.get(e.b)!;
        const energy = (a.load + b.load) / 2;
        ctx.strokeStyle = `rgba(80,190,255,${.16 + energy * .5})`;
        ctx.lineWidth = 1 + energy;
        ctx.beginPath(); ctx.moveTo(a.x * w, a.y * h); ctx.lineTo(b.x * w, b.y * h); ctx.stroke();
        if (energy > .55 && !pausedRef.current) {
          const p = (now * .0008 + a.phase) % 1;
          ctx.fillStyle = "rgba(190,240,255,.9)"; ctx.beginPath();
          ctx.arc((a.x + (b.x - a.x) * p) * w, (a.y + (b.y - a.y) * p) * h, 2, 0, Math.PI * 2); ctx.fill();
        }
      }

      const mind = map.get("central-mind");
      if (mind) {
        const x = mind.x * w, y = mind.y * h, r = 24 + Math.sin(now * .004) * 5;
        const g = ctx.createRadialGradient(x, y, 1, x, y, r * 3);
        g.addColorStop(0, "rgba(100,220,255,.55)"); g.addColorStop(1, "rgba(100,220,255,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 3, 0, Math.PI * 2); ctx.fill();
      }
      for (const n of nodes) {
        const x = n.x * w, y = n.y * h, sel = selectedRef.current === n.id;
        const r = 7 + n.load * 5 + (sel ? 4 : 0);
        ctx.fillStyle = n.health < .5 ? "#ff6575" : n.id === "central-mind" ? "#9beaff" : "#4db5ff";
        ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = n.id === "central-mind" ? 22 : 9;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
        if (sel || n.id === "central-mind") { ctx.fillStyle = "rgba(225,245,255,.9)"; ctx.font = "600 10px ui-monospace"; ctx.textAlign = "center"; ctx.fillText(names[n.id], x, y + r + 14); }
      }
      frames++;
      if (now - fpsAt > 1000) { setFps(Math.round(frames * 1000 / (now - fpsAt))); frames = 0; fpsAt = now; }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); observer.disconnect(); };
  }, [topology]);

  const selectAt = (event: MouseEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget, r = canvas.getBoundingClientRect();
    const x = (event.clientX - r.left) / r.width, y = (event.clientY - r.top) / r.height;
    let best: Node | null = null, bestD = Infinity;
    for (const n of nodesRef.current) { const d = (n.x - x) ** 2 + (n.y - y) ** 2; if (d < bestD) { bestD = d; best = n; } }
    if (best && bestD < .04) setSelected(best.id);
  };

  const togglePause = () => setPaused(v => !v);
  const node = nodesRef.current.find(n => n.id === selected);
  const healthy = nodesRef.current.filter(n => n.health > .6).length;

  return <section className="relative h-full w-full overflow-hidden rounded-xl border border-cyan-400/20 bg-black font-mono">
    <canvas ref={canvasRef} onClick={selectAt} className="absolute inset-0 h-full w-full cursor-crosshair" aria-label="Live CPU rendered department mesh" />
    <div className="pointer-events-none absolute left-3 right-3 top-3 flex justify-between gap-2 text-[10px] uppercase tracking-widest text-cyan-100/80">
      <div><div className="text-cyan-100">JARVIS // LIVE MESH</div><div className="text-cyan-300/50">CPU topology · central mind</div></div>
      <div className="text-right">FPS {fps}<br />NODES {ids.length}<br />LINKS {topology.links.length}</div>
    </div>
    <div className="absolute bottom-3 left-3 right-3 rounded-lg border border-cyan-400/15 bg-black/75 p-3 text-[10px] text-cyan-100/75 backdrop-blur">
      <div className="flex items-center justify-between gap-2">
        <span>HEALTHY {healthy}/{ids.length} · TICK {tick}</span>
        <button type="button" onClick={togglePause} className="pointer-events-auto rounded border border-cyan-400/25 px-2 py-1 text-cyan-100">{paused ? "Resume" : "Pause"}</button>
      </div>
      <div className="mt-2">{node ? `${names[node.id]} · health ${(node.health * 100).toFixed(0)}% · load ${(node.load * 100).toFixed(0)}%` : "Tap a node to inspect it"}</div>
    </div>
  </section>;
}
