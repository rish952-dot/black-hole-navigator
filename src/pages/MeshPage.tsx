import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { NeuralTapestry } from "@/components/blackhole/NeuralTapestry";

/**
 * Dedicated full-screen Neural I/O Mesh inspector.
 * Touch-navigable. Shows every parameter, every connection.
 */
export default function MeshPage() {
  return (
    <main className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex flex-shrink-0 items-center justify-between border-b border-border px-3 py-2 md:px-6 md:py-3">
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="ghost" className="h-8 px-2">
            <Link to="/">
              <ArrowLeft className="mr-1 h-4 w-4" />
              <span className="font-mono text-xs">Lab</span>
            </Link>
          </Button>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-glow accretion-text md:text-base">
              I/O Neural Mesh — full inspector
            </h1>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Adaptive 3k mobile · 30k desktop · auto-focus on broken edges
            </p>
          </div>
        </div>
        <Button asChild size="sm" variant="outline" className="h-8 px-3">
          <Link to="/farm">
            <span className="font-mono text-xs">Agent Farm</span>
          </Link>
        </Button>
      </header>
      <div className="flex-1 overflow-hidden p-2 md:p-3">
        <NeuralTapestry className="h-full" />
      </div>
    </main>
  );
}
