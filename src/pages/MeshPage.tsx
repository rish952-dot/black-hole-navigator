import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Cpu, Network, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NeuralTapestry } from "@/components/blackhole/NeuralTapestry";
import LiveMeshNetwork from "@/components/blackhole/LiveMeshNetwork";

/** Live JARVIS-style inspector: CPU department mesh first, dense neural view second. */
export default function MeshPage() {
  const [view, setView] = useState<"cpu" | "neural">("cpu");

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
              SCHWARZSCHILD LAB // JARVIS MESH
            </h1>
            <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-cyan-300/45">
              central mind · departments · live vector field · CPU-first
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-cyan-400/15 bg-black/50 p-1">
          <Button asChild size="sm" variant="ghost" className="h-8 gap-1 px-2 text-[10px] font-mono uppercase text-cyan-100/45">
            <Link to="/console">
              <Activity className="h-3.5 w-3.5" />
              Console
            </Link>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className={`h-8 gap-1 px-2 text-[10px] font-mono uppercase ${view === "cpu" ? "bg-cyan-500/15 text-cyan-100" : "text-cyan-100/45"}`}
            onClick={() => setView("cpu")}
          >
            <Cpu className="h-3.5 w-3.5" />
            Live
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className={`h-8 gap-1 px-2 text-[10px] font-mono uppercase ${view === "neural" ? "bg-cyan-500/15 text-cyan-100" : "text-cyan-100/45"}`}
            onClick={() => setView("neural")}
          >
            <Network className="h-3.5 w-3.5" />
            Neural
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden p-2 md:p-3">
        <div className="flex h-full min-h-0 flex-col gap-2 md:gap-3">
          <div className="flex shrink-0 items-center justify-between rounded-lg border border-cyan-400/10 bg-black/35 px-3 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-cyan-100/50">
            <span className="flex items-center gap-2"><Activity className="h-3.5 w-3.5 text-cyan-300" /> Network state is visualized live</span>
            <span>{view === "cpu" ? "department topology" : "dense neural parameter field"}</span>
          </div>

          <div className="min-h-0 flex-1">
            {view === "cpu" ? <LiveMeshNetwork /> : <NeuralTapestry className="h-full" />}
          </div>
        </div>
      </div>
    </main>
  );
}
