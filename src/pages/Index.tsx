import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { BlackHoleViewport } from "@/components/blackhole/BlackHoleViewport";
import {
  defaultParams,
  type BlackHoleParams,
} from "@/components/blackhole/BlackHoleQuad";

type Mode = 0 | 1 | 2 | 3;
const MODES: { v: Mode; label: string; desc: string }[] = [
  { v: 0, label: "FULL", desc: "Lensing + disk + Doppler" },
  { v: 1, label: "LENSING", desc: "Geodesic deflection field" },
  { v: 2, label: "DISK", desc: "Accretion only, no stars" },
  { v: 3, label: "GRID", desc: "Geodesic debug grid" },
];

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
  const [paramsA, setParamsA] = useState<BlackHoleParams>(defaultParams);
  const [paramsB, setParamsB] = useState<BlackHoleParams>({
    ...defaultParams,
    spin: 0.95,
    diskTilt: 1.4,
    doppler: 1.0,
  });
  const [paramsC, setParamsC] = useState<BlackHoleParams>({
    ...defaultParams,
    lensing: 0.0,
    mode: 2,
  });
  const [paramsD, setParamsD] = useState<BlackHoleParams>({
    ...defaultParams,
    mode: 1,
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
  const r_isco = 6 * current.mass; // Schwarzschild ISCO
  const r_photon = 3 * current.mass;

  return (
    <main className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      {/* Header */}
      <header className="flex flex-shrink-0 items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-[radial-gradient(circle_at_30%_30%,hsl(var(--primary)),hsl(var(--accent))_60%,#000_85%)] shadow-[0_0_20px_hsl(var(--primary)/0.6)]" />
          <div>
            <h1 className="text-lg font-bold tracking-tight text-glow accretion-text">
              Schwarzschild Lab
            </h1>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              GPU geodesic black-hole simulator
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden items-center gap-2 md:flex">
            <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Parallel tunnels
            </Label>
            <Switch checked={parallel} onCheckedChange={setParallel} />
          </div>
          <Badge
            variant="outline"
            className="border-primary/40 font-mono text-[10px] text-primary"
          >
            r_s = {r_s.toFixed(2)} · ISCO = {r_isco.toFixed(2)} · γ-ring ={" "}
            {r_photon.toFixed(2)}
          </Badge>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Viewport area */}
        <div className="flex-1 p-3">
          {parallel ? (
            <div className="grid h-full grid-cols-1 gap-3 md:grid-cols-2">
              <BlackHoleViewport
                params={paramsA}
                label="Tunnel A"
                sublabel="Reference · Schwarzschild"
                badge={active === "A" ? "EDITING" : undefined}
                active={active === "A"}
                onClick={() => setActive("A")}
              />
              <BlackHoleViewport
                params={paramsB}
                label="Tunnel B"
                sublabel="High spin · tilted disk"
                badge={active === "B" ? "EDITING" : undefined}
                active={active === "B"}
                onClick={() => setActive("B")}
              />
              <BlackHoleViewport
                params={paramsC}
                label="Tunnel C"
                sublabel="Disk only · lensing off"
                badge={active === "C" ? "EDITING" : undefined}
                active={active === "C"}
                onClick={() => setActive("C")}
              />
              <BlackHoleViewport
                params={paramsD}
                label="Tunnel D"
                sublabel="Lensing field debug"
                badge={active === "D" ? "EDITING" : undefined}
                active={active === "D"}
                onClick={() => setActive("D")}
              />
            </div>
          ) : (
            <BlackHoleViewport
              params={current}
              label={`Tunnel ${active}`}
              sublabel="Solo view"
              badge="EDITING"
              active
              className="h-full"
            />
          )}
        </div>

        {/* Right control panel */}
        <aside className="w-[320px] flex-shrink-0 border-l border-border panel-glass">
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
                  className="h-7 font-mono text-xs"
                  onClick={() => setActive(k)}
                >
                  {k}
                </Button>
              ))}
            </div>
          </div>

          <ScrollArea className="h-[calc(100vh-180px)]">
            <Tabs defaultValue="physics" className="w-full">
              <TabsList className="m-3 grid w-[calc(100%-1.5rem)] grid-cols-3">
                <TabsTrigger value="physics" className="text-xs">
                  Physics
                </TabsTrigger>
                <TabsTrigger value="camera" className="text-xs">
                  Camera
                </TabsTrigger>
                <TabsTrigger value="debug" className="text-xs">
                  Debug
                </TabsTrigger>
              </TabsList>

              <TabsContent value="physics" className="space-y-4 px-4 pb-6">
                <NumSlider
                  label="Mass M"
                  value={current.mass}
                  onChange={(v) => update("mass", v)}
                  min={0.3}
                  max={3}
                />
                <NumSlider
                  label="Spin a/M"
                  value={current.spin}
                  onChange={(v) => update("spin", v)}
                  min={0}
                  max={1}
                />
                <NumSlider
                  label="Disk inner (r_s)"
                  value={current.diskInner}
                  onChange={(v) => update("diskInner", v)}
                  min={1.5}
                  max={8}
                />
                <NumSlider
                  label="Disk outer (r_s)"
                  value={current.diskOuter}
                  onChange={(v) => update("diskOuter", v)}
                  min={6}
                  max={30}
                />
                <NumSlider
                  label="Disk tilt"
                  value={current.diskTilt}
                  onChange={(v) => update("diskTilt", v)}
                  min={0}
                  max={Math.PI / 2}
                  unit=" rad"
                />
                <NumSlider
                  label="Doppler beaming"
                  value={current.doppler}
                  onChange={(v) => update("doppler", v)}
                  min={0}
                  max={1}
                />
                <NumSlider
                  label="Lensing strength"
                  value={current.lensing}
                  onChange={(v) => update("lensing", v)}
                  min={0}
                  max={2}
                />

                <div className="mt-4 rounded-md border border-border bg-muted/30 p-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                  <div className="mb-1 text-primary">METRIC READOUT</div>
                  r_s = 2M = {(2 * current.mass).toFixed(3)}
                  <br />
                  r_ISCO = 6M = {(6 * current.mass).toFixed(3)}
                  <br />
                  Photon sphere = 3M = {(3 * current.mass).toFixed(3)}
                  <br />v_orb(ISCO) = {Math.sqrt(1 / 6).toFixed(3)} c
                </div>
              </TabsContent>

              <TabsContent value="camera" className="space-y-4 px-4 pb-6">
                <NumSlider
                  label="Distance"
                  value={current.cameraDistance}
                  onChange={(v) => update("cameraDistance", v)}
                  min={6}
                  max={60}
                  step={0.1}
                />
                <NumSlider
                  label="Orbit"
                  value={current.cameraOrbit}
                  onChange={(v) => update("cameraOrbit", v)}
                  min={0}
                  max={Math.PI * 2}
                  unit=" rad"
                />
                <NumSlider
                  label="Elevation"
                  value={current.cameraElevation}
                  onChange={(v) => update("cameraElevation", v)}
                  min={-1.4}
                  max={1.4}
                  unit=" rad"
                />
                <NumSlider
                  label="Exposure"
                  value={current.exposure}
                  onChange={(v) => update("exposure", v)}
                  min={0.2}
                  max={4}
                />
                <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-3">
                  <Label className="font-mono text-xs text-muted-foreground">
                    Auto-rotate
                  </Label>
                  <Switch
                    checked={current.autoRotate}
                    onCheckedChange={(v) => update("autoRotate", v)}
                  />
                </div>
              </TabsContent>

              <TabsContent value="debug" className="space-y-3 px-4 pb-6">
                <Label className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Render mode
                </Label>
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
                      <span className="text-[9px] font-normal text-muted-foreground">
                        {m.desc}
                      </span>
                    </Button>
                  ))}
                </div>

                <NumSlider
                  label="Integration steps"
                  value={current.steps}
                  onChange={(v) => update("steps", v)}
                  min={40}
                  max={400}
                  step={1}
                />

                <div className="space-y-2 pt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full font-mono text-xs"
                    onClick={() => setCurrent({ ...defaultParams })}
                  >
                    Reset to defaults
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full font-mono text-xs"
                    onClick={() => {
                      // copy active params into all tunnels
                      setParamsA(current);
                      setParamsB(current);
                      setParamsC(current);
                      setParamsD(current);
                    }}
                  >
                    Sync all tunnels → {active}
                  </Button>
                </div>

                <div className="mt-4 rounded-md border border-border bg-muted/30 p-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
                  <div className="mb-1 text-secondary">PARALLEL TUNNELS</div>
                  Run 4 simulations side-by-side with different physics. Click
                  any viewport to edit its parameters. Use "Sync all" to compare
                  one change across modes.
                </div>
              </TabsContent>
            </Tabs>
          </ScrollArea>
        </aside>
      </div>
    </main>
  );
};

export default Index;
