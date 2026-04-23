import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Settings2, Layers, Atom, Activity, Network, Globe2 } from "lucide-react";
import { BlackHoleViewport } from "@/components/blackhole/BlackHoleViewport";
import { SpacetimeGrid } from "@/components/blackhole/SpacetimeGrid";
import { NeuralTapestry } from "@/components/blackhole/NeuralTapestry";
import { MathGraphs } from "@/components/blackhole/MathGraphs";
import {
  defaultParams,
  type BlackHoleParams,
} from "@/components/blackhole/BlackHoleQuad";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

type Mode = 0 | 1 | 2 | 3;
const MODES: { v: Mode; label: string; desc: string }[] = [
  { v: 0, label: "FULL", desc: "Lensing + disk + Doppler" },
  { v: 1, label: "LENSING", desc: "Geodesic deflection field" },
  { v: 2, label: "DISK", desc: "Accretion only, no stars" },
  { v: 3, label: "GRID", desc: "Geodesic debug grid" },
];

type View = "tunnels" | "spacetime" | "tapestry" | "graphs";

function NumSlider({
  label,
  value,
  onChange,
  min,
  max,
  step = 0.01,
  unit,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          {label}
        </Label>
        <span className="font-mono text-xs text-primary">
          {value.toFixed(2)}
          {unit}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
      />
    </div>
  );
}

const Index = () => {
  const isMobile = useIsMobile();
  const [view, setView] = useState<View>("tunnels");
  const [paramsA, setParamsA] = useState<BlackHoleParams>(defaultParams);
  const [paramsB, setParamsB] = useState<BlackHoleParams>({
    ...defaultParams,
    spin: 0.95,
    diskTilt: 1.4,
    doppler: 1.0,
    frameDrag: 1.0,
  });
  const [paramsC, setParamsC] = useState<BlackHoleParams>({
    ...defaultParams,
    lensing: 0.0,
    mode: 2,
    darkMatter: 0.0,
  });
  const [paramsD, setParamsD] = useState<BlackHoleParams>({
    ...defaultParams,
    mode: 1,
    darkMatter: 0.9,
    stringDim: 0.7,
  });
  const [active, setActive] = useState<"A" | "B" | "C" | "D">("A");
  const [parallel, setParallel] = useState(true);

  const current =
    active === "A"
      ? paramsA
      : active === "B"
      ? paramsB
      : active === "C"
      ? paramsC
      : paramsD;
  const setCurrent = (next: BlackHoleParams) => {
    if (active === "A") setParamsA(next);
    else if (active === "B") setParamsB(next);
    else if (active === "C") setParamsC(next);
    else setParamsD(next);
  };
  const update = <K extends keyof BlackHoleParams>(
    key: K,
    val: BlackHoleParams[K],
  ) => setCurrent({ ...current, [key]: val });

  const r_s = 2 * current.mass;
  const r_isco = 6 * current.mass;
  const r_photon = 3 * current.mass;

  const VIEW_TABS: { id: View; label: string; icon: typeof Atom }[] = [
    { id: "tunnels", label: "Tunnels", icon: Layers },
    { id: "spacetime", label: "4D Grid", icon: Globe2 },
    { id: "tapestry", label: "Tapestry", icon: Network },
    { id: "graphs", label: "Graphs", icon: Activity },
  ];

  const ControlPanel = (
    <ScrollArea className={cn("h-full", isMobile ? "max-h-[70vh]" : "")}>
      <div className="border-b border-border px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Editing
          </span>
          <span className="font-mono text-sm text-primary">
            Tunnel {active}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1">
          {(["A", "B", "C", "D"] as const).map((k) => (
            <Button
              key={k}
              size="sm"
              variant={active === k ? "default" : "outline"}
              className="h-8 font-mono text-xs"
              onClick={() => setActive(k)}
            >
              {k}
            </Button>
          ))}
        </div>
      </div>
      <Tabs defaultValue="physics" className="w-full">
        <TabsList className="m-3 grid w-[calc(100%-1.5rem)] grid-cols-4">
          <TabsTrigger value="physics" className="text-[10px]">Physics</TabsTrigger>
          <TabsTrigger value="exotic" className="text-[10px]">Exotic</TabsTrigger>
          <TabsTrigger value="camera" className="text-[10px]">Camera</TabsTrigger>
          <TabsTrigger value="debug" className="text-[10px]">Debug</TabsTrigger>
        </TabsList>

        <TabsContent value="physics" className="space-y-4 px-4 pb-6">
          <NumSlider label="Mass M" value={current.mass} onChange={(v) => update("mass", v)} min={0.3} max={3} />
          <NumSlider label="Spin a/M" value={current.spin} onChange={(v) => update("spin", v)} min={0} max={1} />
          <NumSlider label="Frame drag" value={current.frameDrag} onChange={(v) => update("frameDrag", v)} min={0} max={2} />
          <NumSlider label="Disk inner (r_s)" value={current.diskInner} onChange={(v) => update("diskInner", v)} min={1.5} max={8} />
          <NumSlider label="Disk outer (r_s)" value={current.diskOuter} onChange={(v) => update("diskOuter", v)} min={6} max={30} />
          <NumSlider label="Disk tilt" value={current.diskTilt} onChange={(v) => update("diskTilt", v)} min={0} max={Math.PI / 2} unit=" rad" />
          <NumSlider label="Doppler beaming" value={current.doppler} onChange={(v) => update("doppler", v)} min={0} max={1} />
          <NumSlider label="Lensing strength" value={current.lensing} onChange={(v) => update("lensing", v)} min={0} max={2} />
          <NumSlider label="Grav redshift" value={current.redshift} onChange={(v) => update("redshift", v)} min={0} max={1} />

          <div className="mt-4 rounded-md border border-border bg-muted/30 p-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
            <div className="mb-1 text-primary">METRIC READOUT</div>
            r_s = 2M = {r_s.toFixed(3)}<br />
            r_ISCO = 6M = {r_isco.toFixed(3)}<br />
            Photon sphere = 3M = {r_photon.toFixed(3)}<br />
            v_orb(ISCO) = {Math.sqrt(1 / 6).toFixed(3)} c
          </div>
        </TabsContent>

        <TabsContent value="exotic" className="space-y-4 px-4 pb-6">
          <div className="rounded-md border border-secondary/30 bg-secondary/5 p-2 font-mono text-[10px] text-secondary">
            DARK MATTER · STRING THEORY · 4D MATRIX
          </div>
          <NumSlider label="Dark matter (NFW)" value={current.darkMatter} onChange={(v) => update("darkMatter", v)} min={0} max={1} />
          <NumSlider label="Halo scale (r_s)" value={current.haloScale} onChange={(v) => update("haloScale", v)} min={2} max={60} step={0.1} />
          <NumSlider label="String dim shimmer" value={current.stringDim} onChange={(v) => update("stringDim", v)} min={0} max={1} />

          <div className="rounded-md border border-border bg-muted/30 p-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
            <div className="mb-1 text-secondary">VECTOR SCALING</div>
            ρ_NFW(r) = ρ_s / [(r/r_s)(1+r/r_s)²]<br />
            M_enc(r) ∝ ln(1+x) − x/(1+x)<br />
            6 compactified dims projected as RGB phase ripple
          </div>
        </TabsContent>

        <TabsContent value="camera" className="space-y-4 px-4 pb-6">
          <NumSlider label="Distance" value={current.cameraDistance} onChange={(v) => update("cameraDistance", v)} min={6} max={60} step={0.1} />
          <NumSlider label="Orbit" value={current.cameraOrbit} onChange={(v) => update("cameraOrbit", v)} min={0} max={Math.PI * 2} unit=" rad" />
          <NumSlider label="Elevation" value={current.cameraElevation} onChange={(v) => update("cameraElevation", v)} min={-1.4} max={1.4} unit=" rad" />
          <NumSlider label="Exposure" value={current.exposure} onChange={(v) => update("exposure", v)} min={0.2} max={4} />
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-3">
            <Label className="font-mono text-xs text-muted-foreground">Auto-rotate</Label>
            <Switch checked={current.autoRotate} onCheckedChange={(v) => update("autoRotate", v)} />
          </div>
        </TabsContent>

        <TabsContent value="debug" className="space-y-3 px-4 pb-6">
          <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Render mode</Label>
          <div className="grid grid-cols-2 gap-2">
            {MODES.map((m) => (
              <Button
                key={m.v}
                size="sm"
                variant={current.mode === m.v ? "default" : "outline"}
                className="h-auto flex-col items-start gap-0.5 p-2 text-left"
                onClick={() => update("mode", m.v)}
              >
                <span className="font-mono text-xs">{m.label}</span>
                <span className="text-[9px] font-normal text-muted-foreground">{m.desc}</span>
              </Button>
            ))}
          </div>
          <NumSlider label="Integration steps" value={current.steps} onChange={(v) => update("steps", v)} min={40} max={400} step={1} />
          <div className="space-y-2 pt-3">
            <Button variant="outline" size="sm" className="w-full font-mono text-xs" onClick={() => setCurrent({ ...defaultParams })}>
              Reset to defaults
            </Button>
            <Button variant="outline" size="sm" className="w-full font-mono text-xs" onClick={() => {
              setParamsA(current); setParamsB(current); setParamsC(current); setParamsD(current);
            }}>
              Sync all tunnels → {active}
            </Button>
          </div>
          <div className="mt-4 rounded-md border border-border bg-muted/30 p-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
            <div className="mb-1 text-secondary">PARALLEL TUNNELS</div>
            4 simulations run side-by-side with different physics. Tap any
            viewport to edit. Tapestry view auto-focuses red broken connections.
          </div>
        </TabsContent>
      </Tabs>
    </ScrollArea>
  );

  return (
    <main className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      {/* Header */}
      <header className="flex flex-shrink-0 items-center justify-between border-b border-border px-3 py-2 md:px-6 md:py-3">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="h-7 w-7 rounded-full bg-[radial-gradient(circle_at_30%_30%,hsl(var(--primary)),hsl(var(--accent))_60%,#000_85%)] shadow-[0_0_20px_hsl(var(--primary)/0.6)] md:h-8 md:w-8" />
          <div>
            <h1 className="text-sm font-bold tracking-tight text-glow accretion-text md:text-lg">
              Schwarzschild Lab
            </h1>
            <p className="hidden font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground sm:block">
              GPU geodesic · 4D · neural tapestry
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 md:gap-4">
          <Badge variant="outline" className="hidden border-primary/40 font-mono text-[10px] text-primary lg:inline-flex">
            r_s={r_s.toFixed(2)} · ISCO={r_isco.toFixed(2)} · γ={r_photon.toFixed(2)}
          </Badge>
          {!isMobile && view === "tunnels" && (
            <div className="hidden items-center gap-2 md:flex">
              <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Parallel
              </Label>
              <Switch checked={parallel} onCheckedChange={setParallel} />
            </div>
          )}
          {isMobile && (
            <Sheet>
              <SheetTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 px-2">
                  <Settings2 className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-[88vw] max-w-sm overflow-hidden p-0 panel-glass">
                <div className="h-full overflow-hidden">{ControlPanel}</div>
              </SheetContent>
            </Sheet>
          )}
        </div>
      </header>

      {/* View tabs */}
      <div className="flex flex-shrink-0 items-center gap-1 border-b border-border bg-card/40 px-2 py-1.5 md:px-4">
        {VIEW_TABS.map((t) => {
          const Icon = t.icon;
          return (
            <Button
              key={t.id}
              size="sm"
              variant={view === t.id ? "default" : "ghost"}
              className="h-7 gap-1.5 px-2 font-mono text-[10px] uppercase tracking-wider md:px-3"
              onClick={() => setView(t.id)}
            >
              <Icon className="h-3 w-3" />
              <span className="hidden sm:inline">{t.label}</span>
            </Button>
          );
        })}
        <div className="ml-auto hidden font-mono text-[10px] text-muted-foreground md:block">
          {isMobile ? "TOUCH" : "MOUSE+TOUCH"} · UE-style ACES · adaptive DPR
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Viewport area */}
        <div className="flex-1 overflow-auto p-2 md:p-3">
          {view === "tunnels" && (
            parallel && !isMobile ? (
              <div className="grid h-full grid-cols-1 gap-3 md:grid-cols-2">
                <BlackHoleViewport params={paramsA} label="Tunnel A" sublabel="Reference · Schwarzschild" badge={active === "A" ? "EDITING" : undefined} active={active === "A"} onClick={() => setActive("A")} />
                <BlackHoleViewport params={paramsB} label="Tunnel B" sublabel="Kerr · high spin · tilt" badge={active === "B" ? "EDITING" : undefined} active={active === "B"} onClick={() => setActive("B")} />
                <BlackHoleViewport params={paramsC} label="Tunnel C" sublabel="Disk only · DM off" badge={active === "C" ? "EDITING" : undefined} active={active === "C"} onClick={() => setActive("C")} />
                <BlackHoleViewport params={paramsD} label="Tunnel D" sublabel="Lensing · DM + strings" badge={active === "D" ? "EDITING" : undefined} active={active === "D"} onClick={() => setActive("D")} />
              </div>
            ) : isMobile ? (
              <div className="space-y-2">
                <div className="grid grid-cols-4 gap-1">
                  {(["A", "B", "C", "D"] as const).map((k) => (
                    <Button key={k} size="sm" variant={active === k ? "default" : "outline"} className="h-8 font-mono text-xs" onClick={() => setActive(k)}>{k}</Button>
                  ))}
                </div>
                <BlackHoleViewport params={current} label={`Tunnel ${active}`} sublabel="Tap settings ⚙ to edit" badge="LIVE" active className="h-[60vh]" />
              </div>
            ) : (
              <BlackHoleViewport params={current} label={`Tunnel ${active}`} sublabel="Solo view" badge="EDITING" active className="h-full" />
            )
          )}
          {view === "spacetime" && (
            <SpacetimeGrid mass={current.mass} spin={current.spin} starCount={isMobile ? 250 : 700} className="h-full min-h-[60vh]" />
          )}
          {view === "tapestry" && (
            <NeuralTapestry className="h-full min-h-[60vh]" />
          )}
          {view === "graphs" && (
            <div className="mx-auto max-w-3xl">
              <MathGraphs
                mass={current.mass}
                spin={current.spin}
                diskInner={current.diskInner}
                diskOuter={current.diskOuter}
                darkMatter={current.darkMatter}
                haloScale={current.haloScale}
              />
            </div>
          )}
        </div>

        {/* Right control panel — desktop */}
        {!isMobile && (
          <aside className="w-[340px] flex-shrink-0 border-l border-border panel-glass">
            {ControlPanel}
          </aside>
        )}
      </div>
    </main>
  );
};

export default Index;
