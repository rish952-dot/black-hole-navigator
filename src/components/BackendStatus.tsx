import { Badge } from "@/components/ui/badge";
import type { BackendHealth } from "@/hooks/useBackendHealth";

const LABEL: Record<string, string> = {
  checking: "checking…",
  online: "backend online",
  degraded: "backend degraded",
  offline: "local only",
  unconfigured: "local only",
};

/** Compact, non-blocking backend indicator used across pages. */
export function BackendStatus({ health, compact }: { health: BackendHealth; compact?: boolean }) {
  const tone =
    health.status === "online" ? "text-primary" : health.status === "checking" ? "text-muted-foreground" : "text-destructive";
  const title = health.error ?? (health.payload ? `db ${health.payload.services.database.latencyMs}ms` : "");

  return (
    <button type="button" onClick={health.refresh} title={title} className="inline-flex items-center gap-1.5">
      <Badge variant="outline" className={`font-mono text-[10px] ${tone}`}>
        <span className="mr-1">●</span>
        {LABEL[health.status] ?? health.status}
      </Badge>
      {!compact && health.latencyMs != null && health.status === "online" && (
        <span className="font-mono text-[10px] text-muted-foreground">{health.latencyMs}ms</span>
      )}
    </button>
  );
}
