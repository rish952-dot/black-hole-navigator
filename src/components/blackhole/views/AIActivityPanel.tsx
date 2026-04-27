import { useState, useMemo } from "react";
import { ChevronDown, ChevronUp, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AIDirectiveAction } from "../useAINodes";

/**
 * Per-AI-node action history. The parent maintains a single record per node id
 * and increments counts / accumulates intensity as directives stream in.
 */
export interface AINodeStat {
  nodeId: number;
  /** governor=true for the 65 helper nodes; false for the 6 originals. */
  governor: boolean;
  total: number;
  counts: Record<AIDirectiveAction, number>;
  intensitySum: number;
  intensityAbsSum: number;
  lastAction: AIDirectiveAction | null;
  lastIntensity: number;
  lastReason: string;
  lastTs: number;
}

export function emptyStat(nodeId: number, governor: boolean): AINodeStat {
  return {
    nodeId,
    governor,
    total: 0,
    counts: { boost: 0, freeze: 0, isolate: 0, release: 0, anomaly: 0 },
    intensitySum: 0,
    intensityAbsSum: 0,
    lastAction: null,
    lastIntensity: 0,
    lastReason: "",
    lastTs: 0,
  };
}

const ACTION_COLORS: Record<AIDirectiveAction, string> = {
  boost: "text-[hsl(35_95%_60%)]",
  freeze: "text-[hsl(200_85%_65%)]",
  isolate: "text-muted-foreground",
  release: "text-[hsl(140_60%_60%)]",
  anomaly: "text-destructive",
};

interface Props {
  stats: AINodeStat[];
  className?: string;
}

/**
 * AI Activity Panel — collapsible HUD showing what each of the 71 AI nodes
 * has been doing over time. Aggregates action counts, average intensity, and
 * the most recent reason returned by the model.
 */
export function AIActivityPanel({ stats, className }: Props) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "core" | "gov">("all");

  const filtered = useMemo(() => {
    const f = filter === "core"
      ? stats.filter((s) => !s.governor)
      : filter === "gov"
      ? stats.filter((s) => s.governor)
      : stats;
    // Most recently active first; ties broken by total activity.
    return [...f].sort((a, b) => (b.lastTs - a.lastTs) || (b.total - a.total));
  }, [stats, filter]);

  const totals = useMemo(() => {
    const t = { total: 0, intensitySum: 0, intensityAbsSum: 0, active: 0 };
    stats.forEach((s) => {
      t.total += s.total;
      t.intensitySum += s.intensitySum;
      t.intensityAbsSum += s.intensityAbsSum;
      if (s.total > 0) t.active++;
    });
    return t;
  }, [stats]);

  const avgGlobal = totals.total > 0 ? totals.intensitySum / totals.total : 0;

  return (
    <div
      className={cn(
        "pointer-events-auto rounded border border-[hsl(265_70%_70%/0.4)] bg-black/75 backdrop-blur-md font-mono text-[10px] text-[hsl(265_30%_85%)]",
        className,
      )}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-2 py-1.5 hover:bg-[hsl(265_70%_70%/0.08)]"
      >
        <span className="flex items-center gap-1.5">
          <Activity className="h-3 w-3 text-[hsl(265_70%_75%)]" />
          <span className="uppercase tracking-widest text-[hsl(265_70%_75%)]">
            AI activity
          </span>
          <span className="tabular-nums opacity-70">
            {totals.active}/{stats.length} · {totals.total}t
          </span>
          <span className={cn("tabular-nums", avgGlobal >= 0 ? "text-[hsl(35_95%_60%)]" : "text-destructive")}>
            μ {avgGlobal >= 0 ? "+" : ""}{avgGlobal.toFixed(2)}
          </span>
        </span>
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
      </button>

      {open && (
        <div className="border-t border-[hsl(265_70%_70%/0.25)]">
          {/* Filter chips */}
          <div className="flex gap-1 px-2 py-1.5">
            {(["all", "core", "gov"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wider",
                  filter === k
                    ? "bg-[hsl(265_70%_70%/0.25)] text-[hsl(265_70%_85%)]"
                    : "bg-black/40 text-muted-foreground hover:text-[hsl(265_30%_85%)]",
                )}
              >
                {k === "all" ? `all (${stats.length})` : k === "core" ? "core 6" : "gov 65"}
              </button>
            ))}
          </div>

          {/* Scrollable list */}
          <div className="max-h-[260px] overflow-y-auto px-2 pb-2 space-y-1">
            {filtered.length === 0 && (
              <div className="py-2 text-center text-muted-foreground">no activity yet</div>
            )}
            {filtered.map((s) => {
              const avg = s.total > 0 ? s.intensitySum / s.total : 0;
              const avgAbs = s.total > 0 ? s.intensityAbsSum / s.total : 0;
              const ageS = s.lastTs > 0 ? Math.max(0, (Date.now() - s.lastTs) / 1000) : null;
              return (
                <div
                  key={s.nodeId}
                  className="rounded border border-border/50 bg-black/40 px-1.5 py-1 leading-tight"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "rounded px-1 py-px text-[9px] tabular-nums",
                          s.governor
                            ? "bg-[hsl(265_50%_30%/0.6)] text-[hsl(265_70%_85%)]"
                            : "bg-[hsl(265_70%_55%)] text-black",
                        )}
                      >
                        #{s.nodeId}
                      </span>
                      <span className="text-[9px] uppercase opacity-60">
                        {s.governor ? "gov" : "core"}
                      </span>
                      {s.lastAction && (
                        <span className={cn("text-[10px]", ACTION_COLORS[s.lastAction])}>
                          {s.lastAction}
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums opacity-70">
                      {s.total}t {ageS !== null && <span className="opacity-50">· {ageS.toFixed(0)}s</span>}
                    </span>
                  </div>

                  {/* Mini bar of action counts */}
                  {s.total > 0 && (
                    <div className="mt-0.5 flex h-1 w-full overflow-hidden rounded-sm bg-black/60">
                      {(Object.keys(s.counts) as AIDirectiveAction[]).map((a) => {
                        const w = (s.counts[a] / s.total) * 100;
                        if (w === 0) return null;
                        const bg = {
                          boost: "hsl(35 95% 60%)",
                          freeze: "hsl(200 85% 65%)",
                          isolate: "hsl(220 10% 50%)",
                          release: "hsl(140 60% 55%)",
                          anomaly: "hsl(0 80% 60%)",
                        }[a];
                        return (
                          <div
                            key={a}
                            style={{ width: `${w}%`, background: bg }}
                            title={`${a}: ${s.counts[a]}`}
                          />
                        );
                      })}
                    </div>
                  )}

                  <div className="mt-0.5 flex items-center justify-between text-[9px] tabular-nums opacity-80">
                    <span>
                      avg {avg >= 0 ? "+" : ""}{avg.toFixed(2)} · |μ| {avgAbs.toFixed(2)}
                    </span>
                    <span className="opacity-60">last {s.lastIntensity >= 0 ? "+" : ""}{s.lastIntensity.toFixed(2)}</span>
                  </div>
                  {s.lastReason && (
                    <div className="mt-0.5 truncate text-[9px] italic opacity-70" title={s.lastReason}>
                      “{s.lastReason}”
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
