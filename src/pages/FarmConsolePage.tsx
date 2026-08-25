import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Brain,
  Cpu,
  Activity,
  Play,
  Pause,
  StepForward,
  RotateCcw,
  Network,
  TrendingUp,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FarmEngine, type FarmSnapshot } from "@/farm/engine";
import { CentralMind } from "@/farm/central-mind";
import { DEFAULT_CONFIG, NEUTRAL_MESH, type GenerationRecord } from "@/farm/types";
import type { HiveNode } from "@/farm/hive-topology";

type LogEntry = { ts: string; text: string; tone: "info" | "good" | "bad" };

interface FleetBot {
  botId: number;
  mode: string;
  generation: number;
  agents: number;
  totals: { revenue: number; costs: number; netProfit: number; capital: number };
  diversity: number;
  halted: string | null;
  last: { index: number; netProfit: number; bestFitness: number; bestAgentId: string; born: number; terminated: number; cloned?: number; hunts?: number; accepted?: number } | null;
  hunts?: { total: number; applications: number; accepted: number; recent: { agentId: string; title: string; stage: string; accepted: boolean; revenue: number }[] };
  hive?: {
    paused: boolean;
    account: { balance: number; pending: number };
    layers: { id: string; role: string; nodes: string[]; canWork: boolean }[];
    traffic: { vectors: number };
  } | null;
  pathways: { synapses: number; averageWeight: number; firings: number };
  updatedAt: string;
}

interface FleetStatus {
  mode: string;
  tickMs: number;
  startedAt: string;
  publishedAt: string;
  bots: FleetBot[];
  payout?: {
    status: string;
    chain: string;
    address: string | null;
    asset: string;
    share: number;
    proposals: { botId: number; amount: number }[];
    totalProposed: number;
  };
  contracts?: {
    fetchedAt: string;
    live: { source: string; count: number; error?: string }[];
    listings: { id: string; source: string; title: string; organization?: string; rewardUsd?: number; currency?: string; url: string; kind: string }[];
  } | null;
}

function LiveFleetPanel() {
  const [fleet, setFleet] = useState<FleetStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch(`/farm-live/fleet-status.json?ts=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as FleetStatus;
        if (alive) { setFleet(data); setError(null); }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    poll();
    const id = window.setInterval(poll, 5000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  if (error && !fleet) {
    return (
      <div className="font-mono text-[10px] text-cyan-300/40">
        fleet offline — start with: bun scripts/deploy-farm-live.ts ({error})
      </div>
    );
  }
  if (!fleet) return <div className="font-mono text-[10px] text-cyan-300/40">contacting fleet…</div>;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.14em] text-cyan-300/45">
        <span>{fleet.mode} · tick {fleet.tickMs}ms</span>
        <span>{new Date(fleet.publishedAt).toLocaleTimeString()}</span>
      </div>
      {fleet.payout && (
        <div className="rounded-md border border-amber-400/20 bg-amber-500/5 p-2 font-mono text-[9px]">
          <div className="flex items-center justify-between text-amber-300/80">
            <span>PAYOUT ({fleet.payout.status})</span>
            <span>{fleet.payout.asset}</span>
          </div>
          <div className="mt-0.5 truncate text-amber-100/60">
            → {fleet.payout.address ?? "no destination recorded"}
          </div>
          <div className="mt-0.5 text-amber-100/60">
            proposed {fmt(fleet.payout.totalProposed)} {fleet.payout.asset} · share {fleet.payout.share} · paper only, no funds moved
          </div>
        </div>
      )}
      {fleet.contracts && fleet.contracts.listings.length > 0 && (
        <div className="rounded-md border border-emerald-400/20 bg-emerald-500/5 p-2 font-mono text-[9px]">
          <div className="flex items-center justify-between text-emerald-300/80">
            <span>REAL PAYING CONTRACTS</span>
            <span>{fleet.contracts.listings.length} found</span>
          </div>
          <div className="mt-0.5 text-emerald-100/45">
            live: {fleet.contracts.live.map((l) => `${l.source} ${l.count}`).join(" · ")} — apply via each platform; farm never auto-submits
          </div>
          <div className="mt-1 space-y-0.5">
            {fleet.contracts.listings.slice(0, 8).map((l) => (
              <div key={l.id} className="flex items-baseline justify-between gap-2">
                <a href={l.url} target="_blank" rel="noreferrer" className="truncate text-emerald-100/70 underline decoration-emerald-400/30 hover:text-emerald-100">
                  {l.title}
                </a>
                <span className="shrink-0 text-emerald-300/70">
                  {l.rewardUsd ? `${fmt(l.rewardUsd)} ${l.currency ?? ""}` : l.currency ?? l.kind}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {fleet.bots.map((b) => (
        <div key={b.botId} className="rounded-md border border-cyan-400/10 bg-black/50 p-2">
          <div className="flex items-center justify-between font-mono text-[10px]">
            <span className="text-cyan-100/85">bot-{b.botId}</span>
            {b.halted ? (
              <span className="text-red-300">HALTED</span>
            ) : (
              <span className="text-emerald-300/80">gen {b.generation}</span>
            )}
          </div>
          <div className="mt-1 grid grid-cols-3 gap-1 font-mono text-[9px] text-cyan-300/55">
            <span>agents {b.agents}</span>
            <span className={b.totals.netProfit >= 0 ? "text-emerald-300" : "text-red-300"}>net {fmt(b.totals.netProfit)}</span>
            <span>div {b.diversity.toFixed(2)}</span>
            <span>syn {b.pathways.synapses}</span>
            <span>w {b.pathways.averageWeight.toFixed(2)}</span>
            <span>fire {b.pathways.firings}</span>
          </div>
          {b.last && (
            <div className="mt-1 truncate font-mono text-[9px] text-cyan-300/40">
              best {b.last.bestAgentId} · fit {fmt(b.last.bestFitness)} · +{b.last.born}/-{b.last.terminated}
              {typeof b.last.cloned === "number" && ` · cloned ${b.last.cloned}`}
            </div>
          )}
          {b.hunts && (
            <div className="mt-1 border-t border-cyan-400/10 pt-1">
              <div className="font-mono text-[9px] text-cyan-300/55">
                hunts {b.hunts.total} · applied {b.hunts.applications} · <span className="text-emerald-300/80">won {b.hunts.accepted}</span>
              </div>
              {b.hunts.recent.slice(0, 3).map((h, i) => (
                <div key={i} className="truncate font-mono text-[8px] text-cyan-300/35">
                  {h.accepted ? "✓" : h.stage === "skill-gap" ? "△" : "✗"} {h.agentId} → {h.title}
                  {h.accepted && h.revenue > 0 && <span className="text-emerald-300/70"> +{fmt(h.revenue)}</span>}
                </div>
              ))}
            </div>
          )}
          {b.hive && b.hive.layers?.length > 0 && (
            <div className="mt-1 border-t border-violet-400/10 pt-1">
              <div className="font-mono text-[9px] text-violet-300/55">
                HIVE · {b.hive.paused ? "paused" : "autonomous"} · vectors {b.hive.traffic?.vectors ?? 0}
              </div>
              <div className="space-y-0">
                {b.hive.layers.map((l) => (
                  <div key={l.id} className="flex justify-between font-mono text-[8px] text-violet-200/40">
                    <span className="uppercase">{l.id}</span>
                    <span>{l.nodes.length} node{l.nodes.length === 1 ? "" : "s"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const HIVE_ROLES = ["queen", "specialist", "worker", "worker", "scout", "worker"] as const;

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const now = () => new Date().toLocaleTimeString();

function makeHiveNode(i: number): HiveNode {
  return {
    id: `agent-${i}`,
    role: HIVE_ROLES[i % HIVE_ROLES.length],
    provider: "simulation",
    model: "farm-engine",
    load: 0.2 + (i % 3) * 0.1,
    health: 0.9,
    state: { confidence: 0.5, novelty: 0.5, urgency: 0.5, strategy: [0.5, 0.5, 0.5, 0.5, 0.5] },
    peers: [],
    capabilities: ["research", "analysis", "coding", "classification", "data-cleaning"],
  };
}

function LineChart({ records }: { records: GenerationRecord[] }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    canvas.width = Math.max(1, Math.floor(w * dpr));
    canvas.height = Math.max(1, Math.floor(h * dpr));
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    if (records.length < 2) {
      ctx.fillStyle = "rgba(103,232,249,0.35)";
      ctx.font = "10px monospace";
      ctx.fillText("awaiting generations…", 12, h / 2);
      return;
    }

    const profits = records.map((r) => r.netProfit);
    const fitness = records.map((r) => r.avgFitness);
    const all = [...profits, ...fitness];
    const min = Math.min(...all, 0);
    const max = Math.max(...all, 1);
    const span = max - min || 1;
    const x = (i: number) => 8 + (i / (records.length - 1)) * (w - 16);
    const y = (v: number) => h - 14 - ((v - min) / span) * (h - 28);

    ctx.strokeStyle = "rgba(103,232,249,0.12)";
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const gy = 14 + (g / 4) * (h - 28);
      ctx.beginPath();
      ctx.moveTo(8, gy);
      ctx.lineTo(w - 8, gy);
      ctx.stroke();
    }

    const draw = (values: number[], color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      values.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))));
      ctx.stroke();
    };
    draw(profits, "rgba(34,211,238,0.9)");
    draw(fitness, "rgba(52,211,153,0.85)");

    ctx.fillStyle = "rgba(34,211,238,0.8)";
    ctx.font = "9px monospace";
    ctx.fillText("net profit", 10, 12);
    ctx.fillStyle = "rgba(52,211,153,0.8)";
    ctx.fillText("avg fitness", 76, 12);
  }, [records]);

  return <canvas ref={ref} className="h-full w-full" />;
}

function Kpi({ label, value, tone = "text-cyan-100" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-cyan-400/10 bg-black/40 px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-cyan-300/45">{label}</div>
      <div className={`truncate font-mono text-sm font-bold md:text-base ${tone}`}>{value}</div>
    </div>
  );
}

export default function FarmConsolePage() {
  const [population, setPopulation] = useState(40);
  const [speed, setSpeed] = useState(4);
  const [seed, setSeed] = useState(42);
  const [running, setRunning] = useState(false);
  const [snapshot, setSnapshot] = useState<FarmSnapshot | null>(null);
  const [pathwayStats, setPathwayStats] = useState({ pathways: 0, averageWeight: 0, totalActivations: 0 });
  const [strongest, setStrongest] = useState<{ from: string; to: string; weight: number }[]>([]);
  const [mindHealth, setMindHealth] = useState<{ nodes: number; healthy: number; pendingSignals: number }>({ nodes: 0, healthy: 0, pendingSignals: 0 });
  const [log, setLog] = useState<LogEntry[]>([]);

  const engineRef = useRef<FarmEngine | null>(null);
  const mindRef = useRef<CentralMind | null>(null);

  const pushLog = useCallback((text: string, tone: LogEntry["tone"] = "info") => {
    setLog((prev) => [{ ts: now(), text, tone }, ...prev].slice(0, 120));
  }, []);

  const boot = useCallback((pop: number, sd: number) => {
    const engine = new FarmEngine({
      ...DEFAULT_CONFIG,
      populationSize: pop,
      seed: sd,
      opportunitiesPerGen: Math.max(100, pop * 10),
      mode: "SIMULATION",
    });
    const mind = new CentralMind({ paymentMode: "paper" });
    for (let i = 0; i < 6; i++) mind.addNode(makeHiveNode(i));
    engineRef.current = engine;
    mindRef.current = mind;
    setSnapshot(engine.snapshot());
    setPathwayStats(mind.pathways.stats());
    setStrongest(mind.pathways.strongest(8));
    setMindHealth({ nodes: 6, healthy: 6, pendingSignals: 0 });
  }, []);

  useEffect(() => {
    boot(population, seed);
    pushLog(`engine booted — population ${population}, seed ${seed}, SIMULATION mode`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stepOnce = useCallback(() => {
    const engine = engineRef.current;
    const mind = mindRef.current;
    if (!engine || !mind || engine.halted) return;

    const record = engine.step(NEUTRAL_MESH);

    // Feed the generation outcome into the central mind as a routing task so
    // neural pathways between the AI agents strengthen from real activity.
    const last = engine.tasks[engine.tasks.length - 1];
    mind.route({
      id: `gen-${record.index}`,
      kind: last?.category ?? "analysis",
      priority: Math.min(1, Math.max(0.1, record.avgFitness / 100)),
      requiredCapabilities: [last?.category ?? "analysis"],
      vector: {
        confidence: Math.min(1, Math.max(0, record.avgFitness / 100)),
        novelty: record.diversity,
        urgency: record.netProfit < 0 ? 0.9 : 0.4,
        strategy: [record.diversity, Math.min(1, record.born / Math.max(1, record.agents))],
      },
    });
    const best = engine.agents.find((a) => a.id === record.bestAgentId);
    if (best && record.netProfit > 0) mind.reward(`agent-${record.index % 6}`, Math.min(100, record.netProfit / 10), `gen ${record.index} surplus`);

    setSnapshot(engine.snapshot());
    setPathwayStats(mind.pathways.stats());
    setStrongest(mind.pathways.strongest(8));
    const h = mind.health();
    setMindHealth({ nodes: h.nodes, healthy: h.healthy, pendingSignals: h.pendingSignals });

    pushLog(
      `gen ${record.index}: net ${fmt(record.netProfit)} · best ${record.bestAgentId} (${fmt(record.bestFitness)}) · +${record.born} born / -${record.terminated} culled`,
      record.netProfit >= 0 ? "good" : "bad",
    );
    if (engine.halted) {
      setRunning(false);
      pushLog(`HALTED — ${engine.halted}`, "bad");
    }
  }, [pushLog]);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(stepOnce, Math.max(120, 1200 - speed * 110));
    return () => window.clearInterval(id);
  }, [running, speed, stepOnce]);

  const reset = useCallback(() => {
    setRunning(false);
    boot(population, seed);
    pushLog(`engine reset — population ${population}, seed ${seed}`);
  }, [boot, population, seed, pushLog]);

  const lastGen: GenerationRecord | undefined = useMemo(
    () => snapshot?.generations[snapshot.generations.length - 1],
    [snapshot],
  );

  return (
    <main className="flex h-screen w-full flex-col overflow-hidden bg-[#020308] text-foreground">
      <header className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-cyan-400/10 bg-black/40 px-3 py-2 md:px-6 md:py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button asChild size="sm" variant="ghost" className="h-8 px-2 text-cyan-100/70 hover:text-cyan-100">
            <Link to="/">
              <ArrowLeft className="mr-1 h-4 w-4" />
              <span className="font-mono text-xs">Lab</span>
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold tracking-[0.08em] text-cyan-100 md:text-base">
              FARM OPERATIONS CONSOLE
            </h1>
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-cyan-300/45">
              evolutionary engine · central mind · neural pathways · simulation only
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="outline" className="border-emerald-400/30 font-mono text-[9px] uppercase text-emerald-300">
            SIMULATION
          </Badge>
          <Button asChild size="sm" variant="ghost" className="h-8 px-2 font-mono text-xs text-cyan-100/70 hover:text-cyan-100">
            <Link to="/mesh">
              <Network className="mr-1 h-4 w-4" />
              Mesh
            </Link>
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden p-2 md:grid-cols-[280px_1fr_300px] md:gap-3 md:p-3">
        {/* Controls */}
        <section className="flex min-h-0 flex-col gap-3 rounded-lg border border-cyan-400/10 bg-black/35 p-3">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-300/60">
            <Cpu className="h-3.5 w-3.5" /> Engine controls
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-8 flex-1 bg-cyan-500/20 font-mono text-xs text-cyan-100 hover:bg-cyan-500/30"
              onClick={() => setRunning((r) => !r)}
              disabled={!!snapshot?.halted}
            >
              {running ? <Pause className="mr-1 h-3.5 w-3.5" /> : <Play className="mr-1 h-3.5 w-3.5" />}
              {running ? "Pause" : "Run"}
            </Button>
            <Button size="sm" variant="ghost" className="h-8 border border-cyan-400/15 font-mono text-xs text-cyan-100/70" onClick={stepOnce} disabled={running || !!snapshot?.halted}>
              <StepForward className="mr-1 h-3.5 w-3.5" /> Step
            </Button>
            <Button size="sm" variant="ghost" className="h-8 border border-cyan-400/15 font-mono text-xs text-cyan-100/70" onClick={reset}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset
            </Button>
          </div>

          <div className="space-y-3">
            <div>
              <Label className="font-mono text-[10px] uppercase text-cyan-300/50">Population — {population}</Label>
              <Slider value={[population]} min={10} max={100} step={5} onValueChange={([v]) => setPopulation(v)} className="mt-2" />
            </div>
            <div>
              <Label className="font-mono text-[10px] uppercase text-cyan-300/50">Speed — {speed}/10</Label>
              <Slider value={[speed]} min={1} max={10} step={1} onValueChange={([v]) => setSpeed(v)} className="mt-2" />
            </div>
            <div>
              <Label className="font-mono text-[10px] uppercase text-cyan-300/50">Seed — {seed}</Label>
              <Slider value={[seed]} min={1} max={999} step={1} onValueChange={([v]) => setSeed(v)} className="mt-2" />
            </div>
          </div>

          {snapshot?.halted && (
            <div className="flex items-start gap-2 rounded-md border border-red-400/30 bg-red-500/10 p-2 font-mono text-[10px] text-red-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {snapshot.halted}
            </div>
          )}

          <div className="min-h-0 flex-1">
            <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-300/60">
              <Activity className="h-3.5 w-3.5" /> Event log
            </div>
            <ScrollArea className="h-full max-h-[38vh] rounded-md border border-cyan-400/10 bg-black/50 p-2 md:max-h-none">
              <div className="space-y-1">
                {log.map((e, i) => (
                  <div key={i} className="font-mono text-[10px] leading-relaxed">
                    <span className="text-cyan-300/35">{e.ts} </span>
                    <span className={e.tone === "good" ? "text-emerald-300" : e.tone === "bad" ? "text-red-300" : "text-cyan-100/70"}>
                      {e.text}
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </section>

        {/* Main output */}
        <section className="flex min-h-0 flex-col gap-2 md:gap-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Kpi label="Generation" value={String(snapshot?.generation ?? 0)} />
            <Kpi label="Agents" value={String(snapshot?.agents.length ?? 0)} />
            <Kpi
              label="Net profit"
              value={fmt(snapshot?.totals.netProfit ?? 0)}
              tone={(snapshot?.totals.netProfit ?? 0) >= 0 ? "text-emerald-300" : "text-red-300"}
            />
            <Kpi label="Diversity" value={fmt(snapshot?.diversity ?? 0)} />
            <Kpi label="Revenue" value={fmt(snapshot?.totals.revenue ?? 0)} />
            <Kpi label="Costs" value={fmt(snapshot?.totals.costs ?? 0)} tone="text-amber-300" />
            <Kpi label="Best fitness" value={fmt(lastGen?.bestFitness ?? 0)} tone="text-emerald-300" />
            <Kpi label="Best agent" value={lastGen?.bestAgentId ?? "—"} />
          </div>

          <div className="min-h-0 flex-1 rounded-lg border border-cyan-400/10 bg-black/35 p-2">
            <div className="mb-1 flex items-center gap-2 px-1 font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-300/60">
              <TrendingUp className="h-3.5 w-3.5" /> Generations
            </div>
            <div className="h-[calc(100%-1.5rem)]">
              {/* engine mutates its generations array in place; copy so the chart effect re-fires */}
              <LineChart records={[...(snapshot?.generations ?? [])]} />
            </div>
          </div>

          <div className="grid shrink-0 grid-cols-3 gap-2">
            <Kpi label="Tasks executed" value={String(snapshot?.tasks.length ?? 0)} />
            <Kpi label="Ledger entries" value={String(snapshot?.transactions.length ?? 0)} />
            <Kpi label="Capital in play" value={fmt(snapshot?.totals.capital ?? 0)} />
          </div>
        </section>

        {/* Neural pathways + central mind */}
        <section className="flex min-h-0 flex-col gap-2 overflow-y-auto md:gap-3">
          <div className="rounded-lg border border-emerald-400/15 bg-black/35 p-3">
            <div className="mb-2 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-300/70">
              <span className="flex items-center gap-2"><Cpu className="h-3.5 w-3.5" /> Live bot fleet</span>
              <span className="text-[8px] text-emerald-300/40">deployed processes</span>
            </div>
            <LiveFleetPanel />
          </div>

          <div className="rounded-lg border border-cyan-400/10 bg-black/35 p-3">
            <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-300/60">
              <Brain className="h-3.5 w-3.5" /> Neural pathways
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Kpi label="Synapses" value={String(pathwayStats.pathways)} />
              <Kpi label="Avg weight" value={fmt(pathwayStats.averageWeight)} />
              <Kpi label="Firings" value={String(pathwayStats.totalActivations)} />
            </div>
            <div className="mt-2 space-y-1">
              {strongest.length === 0 && (
                <div className="font-mono text-[10px] text-cyan-300/35">no synapses yet — run generations</div>
              )}
              {strongest.map((p) => (
                <div key={`${p.from}->${p.to}`} className="flex items-center gap-2 font-mono text-[10px]">
                  <span className="w-28 truncate text-cyan-100/70">
                    {p.from} → {p.to}
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded bg-cyan-950">
                    <div className="h-full rounded bg-cyan-400/70" style={{ width: `${Math.round(p.weight * 100)}%` }} />
                  </div>
                  <span className="w-9 text-right text-cyan-300/70">{p.weight.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-cyan-400/10 bg-black/35 p-3">
            <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-300/60">
              <Network className="h-3.5 w-3.5" /> Central mind
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Kpi label="Hive nodes" value={String(mindHealth.nodes)} />
              <Kpi label="Healthy" value={String(mindHealth.healthy)} tone="text-emerald-300" />
              <Kpi label="Signals" value={String(mindHealth.pendingSignals)} />
            </div>
          </div>

          <div className="min-h-0 flex-1 rounded-lg border border-cyan-400/10 bg-black/35 p-3">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-300/60">Top agents</div>
            <ScrollArea className="h-full max-h-[30vh] md:max-h-none">
              <div className="space-y-1">
                {[...(snapshot?.agents ?? [])]
                  .sort((a, b) => b.stats.fitness - a.stats.fitness)
                  .slice(0, 12)
                  .map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-2 font-mono text-[10px]">
                      <span className="truncate text-cyan-100/70">
                        {a.id} <span className="text-cyan-300/35">g{a.generation} {a.origin}</span>
                      </span>
                      <span className={a.stats.netProfit >= 0 ? "text-emerald-300" : "text-red-300"}>
                        {fmt(a.stats.netProfit)}
                      </span>
                    </div>
                  ))}
              </div>
            </ScrollArea>
          </div>
        </section>
      </div>
    </main>
  );
}
