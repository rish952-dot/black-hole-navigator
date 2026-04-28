import { useState } from "react";
import { cn } from "@/lib/utils";
import type { DebugEvent, StreamProvider } from "../useAIStream";

/**
 * AIDebugPanel — collapsible HUD that shows live stream telemetry:
 *   - status, latency, request/directive counters
 *   - provider toggle (Lovable AI vs external debug provider)
 *   - last 30 raw SSE frames with kind + compact payload
 *
 * Lives in the same overlay column as the other AI panels so the user can
 * watch the model's brain in real time.
 */
interface Props {
  className?: string;
  events: DebugEvent[];
  status: string;
  streamCount: number;
  directiveCount: number;
  lastLatencyMs: number | null;
  provider: StreamProvider;
  onProviderChange: (p: StreamProvider) => void;
  overclock: boolean;
  debugProviderConfigured: boolean;
}

const KIND_COLORS: Record<DebugEvent["kind"], string> = {
  open:      "text-[hsl(140_60%_75%)]",
  directive: "text-[hsl(265_70%_85%)]",
  error:     "text-destructive",
  done:      "text-muted-foreground",
  http:      "text-secondary",
  reconnect: "text-accent",
};

function summarize(e: DebugEvent): string {
  const p = e.payload as Record<string, unknown> | null;
  if (!p) return "";
  switch (e.kind) {
    case "directive": {
      const d = p as { nodeId?: number; action?: string; intensity?: number; reason?: string };
      return `#${d.nodeId} ${d.action} ${(d.intensity ?? 0).toFixed(2)} — ${(d.reason ?? "").slice(0, 28)}`;
    }
    case "open":
      return `${(p.provider as string) ?? "?"} · ${(p.model as string) ?? "?"}${p.overclock ? " · OC" : ""}`;
    case "http":
      return `${p.status} · ${(p.provider as string) ?? "?"}${p.overclock ? " · OC" : ""}`;
    case "error":
      return String(p.message ?? p);
    case "reconnect":
      return `+${p.afterMs}ms`;
    default:
      return "";
  }
}

export function AIDebugPanel({
  className,
  events,
  status,
  streamCount,
  directiveCount,
  lastLatencyMs,
  provider,
  onProviderChange,
  overclock,
  debugProviderConfigured,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={cn(
        "pointer-events-auto rounded border border-[hsl(200_70%_60%/0.4)] bg-black/70 font-mono text-[10px] text-[hsl(200_70%_85%)] backdrop-blur-md",
        className,
      )}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-2 py-1 uppercase tracking-widest"
      >
        <span>ai debug</span>
        <span className="tabular-nums opacity-70">
          {status} · {streamCount}s · {directiveCount}d{lastLatencyMs !== null ? ` · ${Math.round(lastLatencyMs)}ms` : ""}
        </span>
      </button>

      {open && (
        <div className="space-y-1.5 border-t border-[hsl(200_70%_60%/0.3)] px-2 py-2">
          <div className="flex gap-1">
            <button
              onClick={() => onProviderChange("default")}
              className={cn(
                "flex-1 rounded border px-1.5 py-0.5 text-[9px] uppercase",
                provider === "default"
                  ? "border-[hsl(200_70%_60%)] bg-[hsl(200_70%_60%/0.15)]"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              Lovable AI
            </button>
            <button
              onClick={() => debugProviderConfigured && onProviderChange("debug")}
              disabled={!debugProviderConfigured}
              title={debugProviderConfigured ? "" : "Add AI_DEBUG_API_KEY + AI_DEBUG_BASE_URL secrets"}
              className={cn(
                "flex-1 rounded border px-1.5 py-0.5 text-[9px] uppercase",
                provider === "debug"
                  ? "border-[hsl(35_85%_60%)] bg-[hsl(35_85%_60%/0.15)] text-[hsl(35_85%_75%)]"
                  : "border-border text-muted-foreground hover:text-foreground",
                !debugProviderConfigured && "opacity-40",
              )}
            >
              External {overclock && provider === "debug" ? "OC" : ""}
            </button>
          </div>

          <div className="text-[9px] opacity-60">
            {provider === "debug"
              ? "Routing through external AI_DEBUG_BASE_URL"
              : "Routing through Lovable AI Gateway"}
            {overclock && " · overclock active"}
          </div>

          <div className="max-h-40 overflow-y-auto rounded border border-border/60 bg-black/40 p-1">
            {events.length === 0 ? (
              <div className="px-1 py-2 text-center opacity-50">— waiting for stream —</div>
            ) : (
              events.slice(0, 30).map((e, i) => (
                <div key={`${e.ts}-${i}`} className="flex gap-1 leading-tight">
                  <span className="w-12 shrink-0 opacity-50 tabular-nums">
                    {new Date(e.ts).toISOString().slice(14, 22)}
                  </span>
                  <span className={cn("w-14 shrink-0 uppercase", KIND_COLORS[e.kind])}>
                    {e.kind}
                  </span>
                  <span className="truncate opacity-80">{summarize(e)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
