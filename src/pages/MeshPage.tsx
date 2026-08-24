import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Cpu, Network } from "lucide-react";
import { NeuralTapestry } from "@/components/blackhole/NeuralTapestry";
import LiveMeshNetwork from "@/components/blackhole/LiveMeshNetwork";

/** Dedicated mesh inspector with a lightweight CPU live topology view. */
export default function MeshPage() {
  const [view, setView] = useState<"cpu" | "neural">("cpu");

  return (
    <main className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2 md:px-6 md:py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Button asChild size="sm" variant="ghost" className="h-8 px-2">
            <Link to="/">
              <ArrowLeft className="mr-1 h-4 w-4" />
              <span className="font-mono text-xs">Lab</span>
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold tracking-tight text-glow accretion-text md:text-base">
              I/O Neural Mesh — live inspector
            </h1>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              {view === "cpu" ? "CPU live topology · low overhead · adaptive links" : "WebGL neural tapestry · high density renderer"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-border/70 bg-background/70 p-1">
          <Button size="sm" variant={view === "cpu" ? "secondary" : "ghost"} className="h-8 gap-1 px-2 text-[10px] font-mono uppercase" onClick={() => setView("cpu")}>
            <Cpu className="h-3.5 w-3.5" /> CPU Mesh
          </Button>
          <Button size="sm" variant={view === "neural" ? "secondary" : "ghost"} className="h-8 gap-1 px-2 text-[10px] font-mono uppercase" onClick={() => setView("neural")}>
            <Network className="h-3.5 w-3.5" /> Neural
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden p-2 md:p-3">
        {view === "cpu" ? <LiveMeshNetwork /> : <NeuralTapestry className="h-full" />}
      </div>
    </main>
  );
}
