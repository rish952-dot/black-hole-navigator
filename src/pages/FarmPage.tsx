import { useMemo } from "react";
import { NavLink } from "@/components/NavLink";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FITNESS_FORMULAS } from "@/farm/fitness";
import { useFarm } from "@/farm/useFarm";
import { DEFAULT_CONFIG, type FarmConfig } from "@/farm/types";

const money = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4 bg-card/60 border-border/60">
      <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-xl text-foreground">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
    </Card>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const d = useMemo(() => {
    if (values.length < 2) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    return values
      .map((v, i) => `${(i / (values.length - 1)) * 100},${30 - ((v - min) / span) * 28}`)
      .join(" ");
  }, [values]);
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="w-full h-16">
      <polyline points={d} fill="none" stroke="hsl(var(--primary))" strokeWidth="0.8" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function FarmPage() {
  const { config, setConfig, snapshot, running, setRunning, speedMs, setSpeedMs, step, reset, lineages, field } =
    useFarm();

  const ranked = useMemo(
    () => [...snapshot.agents].sort((a, b) => b.stats.fitness - a.stats.fitness),
    [snapshot],
  );
  const best = ranked[0];
  const gens = snapshot.generations;

  const set = <K extends keyof FarmConfig>(k: K, v: FarmConfig[K]) => setConfig({ ...config, [k]: v });

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60 px-4 py-3 flex flex-wrap items-center gap-3">
        <h1 className="text-sm font-mono uppercase tracking-[0.3em] text-primary">Evolutionary Agent Farm</h1>
        <Badge variant="outline" className="font-mono text-[10px]">{config.mode}</Badge>
        <nav className="ml-auto flex gap-3 text-xs text-muted-foreground">
          <NavLink to="/" className="hover:text-foreground" activeClassName="text-foreground">Home</NavLink>
          <NavLink to="/mesh" className="hover:text-foreground" activeClassName="text-foreground">Mesh</NavLink>
        </nav>
      </header>

      <section className="px-4 py-3 flex flex-wrap items-center gap-2 border-b border-border/60">
        <Button size="sm" onClick={() => setRunning(!running)} disabled={!!snapshot.halted}>
          {running ? "Pause" : "Run"}
        </Button>
        <Button size="sm" variant="secondary" onClick={step} disabled={running || !!snapshot.halted}>
          Step generation
        </Button>
        <Button size="sm" variant="ghost" onClick={() => reset(config)}>Reset</Button>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground ml-2 w-48">
          <span>Speed</span>
          <Slider
            value={[1600 - speedMs]}
            min={0}
            max={1500}
            step={100}
            onValueChange={([v]) => setSpeedMs(1600 - v)}
          />
        </div>
        <div className="ml-auto text-[11px] font-mono text-muted-foreground">
          gen {snapshot.generation} · mesh κ{field.curvature.toFixed(2)} ρ{field.energyDensity.toFixed(2)} σ
          {field.stability.toFixed(2)}
        </div>
      </section>

      {snapshot.halted && (
        <div className="px-4 py-2 bg-destructive/15 text-destructive text-xs font-mono">
          HALTED — circuit breaker: {snapshot.halted}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4">
        <Stat label="Net profit" value={money(snapshot.totals.netProfit)} hint={`rev ${money(snapshot.totals.revenue)}`} />
        <Stat label="Capital" value={money(snapshot.totals.capital)} />
        <Stat label="Population" value={`${snapshot.agents.length}`} hint={`gen ${snapshot.generation}`} />
        <Stat label="Diversity" value={snapshot.diversity.toFixed(2)} hint="unique strategies" />
        <Stat label="Best fitness" value={best ? best.stats.fitness.toFixed(0) : "—"} hint={best?.id} />
      </div>

      <Tabs defaultValue="overview" className="px-4 pb-10">
        <TabsList className="flex-wrap h-auto">
          {["overview", "agents", "generations", "lineages", "tasks", "ledger", "config"].map((t) => (
            <TabsTrigger key={t} value={t} className="capitalize text-xs">{t}</TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="grid md:grid-cols-2 gap-4 pt-4">
          <Card className="p-4">
            <div className="text-xs text-muted-foreground mb-2">Best fitness per generation</div>
            <Sparkline values={gens.map((g) => g.bestFitness)} />
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground mb-2">Net profit per generation</div>
            <Sparkline values={gens.map((g) => g.netProfit)} />
          </Card>
          <Card className="p-4 md:col-span-2">
            <div className="text-xs text-muted-foreground mb-2">
              Top agent genome {best ? `— ${best.id}` : ""}
            </div>
            {best && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 font-mono text-[11px]">
                {Object.entries(best.genome).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 border-b border-border/40 py-1">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="text-right truncate">{Array.isArray(v) ? v.join(",") : String(v)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="agents" className="pt-4">
          <div className="overflow-auto max-h-[60vh] rounded border border-border/60">
            <table className="w-full text-[11px] font-mono">
              <thead className="sticky top-0 bg-card text-muted-foreground">
                <tr>{["#", "agent", "origin", "model", "strategy", "net", "roi", "succ", "fitness", "flags"].map((h) => (
                  <th key={h} className="text-left px-2 py-1.5">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {ranked.slice(0, 120).map((a, i) => (
                  <tr key={a.id} className="border-t border-border/40">
                    <td className="px-2 py-1 text-muted-foreground">{i + 1}</td>
                    <td className="px-2 py-1">{a.id}</td>
                    <td className="px-2 py-1 text-muted-foreground">{a.origin}</td>
                    <td className="px-2 py-1">{a.genome.model}</td>
                    <td className="px-2 py-1">{a.genome.taskSelectionStrategy}</td>
                    <td className={`px-2 py-1 ${a.stats.netProfit >= 0 ? "text-primary" : "text-destructive"}`}>
                      {money(a.stats.netProfit)}
                    </td>
                    <td className="px-2 py-1">{a.stats.roi.toFixed(2)}</td>
                    <td className="px-2 py-1">{(a.stats.successRate * 100).toFixed(0)}%</td>
                    <td className="px-2 py-1">{a.stats.fitness.toFixed(0)}</td>
                    <td className="px-2 py-1 text-destructive">{a.stats.flagged.join(" ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="generations" className="pt-4">
          <div className="overflow-auto max-h-[60vh] rounded border border-border/60">
            <table className="w-full text-[11px] font-mono">
              <thead className="sticky top-0 bg-card text-muted-foreground">
                <tr>{["gen", "revenue", "costs", "net", "avg fit", "best fit", "best", "diversity", "term", "born"].map((h) => (
                  <th key={h} className="text-left px-2 py-1.5">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {[...gens].reverse().map((g) => (
                  <tr key={g.index} className="border-t border-border/40">
                    <td className="px-2 py-1">{g.index}</td>
                    <td className="px-2 py-1">{money(g.revenue)}</td>
                    <td className="px-2 py-1">{money(g.costs)}</td>
                    <td className={`px-2 py-1 ${g.netProfit >= 0 ? "text-primary" : "text-destructive"}`}>{money(g.netProfit)}</td>
                    <td className="px-2 py-1">{g.avgFitness}</td>
                    <td className="px-2 py-1">{g.bestFitness}</td>
                    <td className="px-2 py-1 text-muted-foreground">{g.bestAgentId}</td>
                    <td className="px-2 py-1">{g.diversity}</td>
                    <td className="px-2 py-1">{g.terminated}</td>
                    <td className="px-2 py-1">{g.born}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="lineages" className="pt-4 grid md:grid-cols-2 gap-3">
          {lineages.slice(0, 20).map((l) => (
            <Card key={l.lineage} className="p-3">
              <div className="flex justify-between text-xs font-mono">
                <span className="text-primary">{l.lineage}</span>
                <span className="text-muted-foreground">{l.count} agents</span>
              </div>
              <Progress className="mt-2 h-1" value={Math.min(100, (l.count / config.populationSize) * 400)} />
              <div className="mt-2 text-[11px] font-mono text-muted-foreground">
                best fit {l.bestFitness.toFixed(0)} · net {money(l.netProfit)}
              </div>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="tasks" className="pt-4">
          <div className="overflow-auto max-h-[60vh] rounded border border-border/60">
            <table className="w-full text-[11px] font-mono">
              <thead className="sticky top-0 bg-card text-muted-foreground">
                <tr>{["agent", "category", "result", "payout", "cost", "net", "min", "note"].map((h) => (
                  <th key={h} className="text-left px-2 py-1.5">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {snapshot.tasks.map((t) => (
                  <tr key={t.id} className="border-t border-border/40">
                    <td className="px-2 py-1">{t.agentId}</td>
                    <td className="px-2 py-1 text-muted-foreground">{t.category}</td>
                    <td className={`px-2 py-1 ${t.success ? "text-primary" : "text-destructive"}`}>{t.success ? "ok" : "fail"}</td>
                    <td className="px-2 py-1">{money(t.payout)}</td>
                    <td className="px-2 py-1">{money(t.cost)}</td>
                    <td className="px-2 py-1">{money(t.net)}</td>
                    <td className="px-2 py-1">{t.durationMin}</td>
                    <td className="px-2 py-1 text-muted-foreground">{t.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="ledger" className="pt-4">
          <div className="overflow-auto max-h-[60vh] rounded border border-border/60">
            <table className="w-full text-[11px] font-mono">
              <thead className="sticky top-0 bg-card text-muted-foreground">
                <tr>{["tx", "agent", "gen", "type", "amount", "description"].map((h) => (
                  <th key={h} className="text-left px-2 py-1.5">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {snapshot.transactions.map((t) => (
                  <tr key={t.id} className="border-t border-border/40">
                    <td className="px-2 py-1 text-muted-foreground">{t.id}</td>
                    <td className="px-2 py-1">{t.agentId}</td>
                    <td className="px-2 py-1">{t.generation}</td>
                    <td className="px-2 py-1 text-muted-foreground">{t.type}</td>
                    <td className={`px-2 py-1 ${t.amount >= 0 ? "text-primary" : "text-destructive"}`}>{money(t.amount)}</td>
                    <td className="px-2 py-1 text-muted-foreground">{t.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="config" className="pt-4 grid md:grid-cols-2 gap-4">
          <Card className="p-4 space-y-4">
            {([
              ["populationSize", 10, 300, 10],
              ["mutationRate", 0.01, 1, 0.01],
              ["crossoverRate", 0, 1, 0.05],
              ["explorationRate", 0, 0.5, 0.05],
              ["elitePct", 0.02, 0.4, 0.02],
              ["survivorPct", 0.1, 0.8, 0.05],
              ["opportunitiesPerGen", 100, 4000, 100],
            ] as const).map(([key, min, max, step_]) => (
              <div key={key}>
                <div className="flex justify-between text-[11px] font-mono mb-1">
                  <span className="text-muted-foreground">{key}</span>
                  <span>{config[key]}</span>
                </div>
                <Slider
                  value={[config[key] as number]}
                  min={min}
                  max={max}
                  step={step_}
                  onValueChange={([v]) => set(key, v as never)}
                />
              </div>
            ))}
          </Card>
          <Card className="p-4 space-y-4">
            <div>
              <div className="text-[11px] text-muted-foreground mb-2">Fitness formula</div>
              <div className="grid gap-1">
                {(Object.keys(FITNESS_FORMULAS) as (keyof typeof FITNESS_FORMULAS)[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => set("fitnessFormula", f)}
                    className={`text-left text-[11px] font-mono px-2 py-1.5 rounded border ${
                      config.fitnessFormula === f ? "border-primary text-primary" : "border-border/50 text-muted-foreground"
                    }`}
                  >
                    {f} — {FITNESS_FORMULAS[f]}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono text-muted-foreground">Mesh coupling (symbiosis)</span>
              <Switch checked={config.meshCoupling} onCheckedChange={(v) => set("meshCoupling", v)} />
            </div>
            <div className="text-[11px] font-mono text-muted-foreground leading-relaxed">
              Deployment mode: {config.mode}. Simulation only — no real funds, no external API calls,
              no AI credits consumed. Circuit breakers: max total loss {money(config.maxTotalLoss)},
              max spend/gen {money(config.maxDailySpend)}.
            </div>
            <Button size="sm" variant="secondary" onClick={() => reset(DEFAULT_CONFIG)}>
              Restore defaults & reset
            </Button>
          </Card>
        </TabsContent>
      </Tabs>
    </main>
  );
}
