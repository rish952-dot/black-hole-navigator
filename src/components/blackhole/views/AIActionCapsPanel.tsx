import { useState } from "react";
import { ChevronDown, ChevronUp, Shield, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActionCaps } from "../useAIStream";
import { DEFAULT_ACTION_CAPS } from "../useAIStream";
import type { AIDirectiveAction } from "../useAINodes";

interface Props {
  value: ActionCaps;
  onChange: (next: ActionCaps) => void;
  className?: string;
}

const ACTIONS: { key: AIDirectiveAction; label: string; tint: string; help: string }[] = [
  { key: "boost",   label: "Boost",   tint: "hsl(35 95% 60%)",  help: "Energy pump on a node" },
  { key: "freeze",  label: "Freeze",  tint: "hsl(200 85% 65%)", help: "Pauses node animation" },
  { key: "isolate", label: "Isolate", tint: "hsl(220 10% 55%)", help: "Disconnects node edges" },
  { key: "release", label: "Release", tint: "hsl(140 60% 55%)", help: "Resets node to idle" },
  { key: "anomaly", label: "Anomaly", tint: "hsl(0 80% 60%)",   help: "Visible hotspot pulse" },
];

/**
 * AIActionCapsPanel — collapsible row of sliders that limit how aggressive
 * each action type can be when issued by the AI. 0 disables the action
 * entirely, 1 means uncapped (raw model intensity passes through).
 */
export function AIActionCapsPanel({ value, onChange, className }: Props) {
  const [open, setOpen] = useState(false);

  const update = (k: AIDirectiveAction, v: number) =>
    onChange({ ...value, [k]: Math.max(0, Math.min(1, v)) });

  const reset = () => onChange({ ...DEFAULT_ACTION_CAPS });

  // How many actions are clamped below 1.0 — quick header indicator.
  const limited = ACTIONS.filter((a) => value[a.key] < 1).length;

  return (
    <div
      className={cn(
        "pointer-events-auto rounded border border-border bg-black/75 backdrop-blur-md font-mono text-[10px] text-foreground",
        className,
      )}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-2 py-1.5 hover:bg-white/5"
      >
        <span className="flex items-center gap-1.5">
          <Shield className="h-3 w-3 text-secondary" />
          <span className="uppercase tracking-widest text-secondary">AI caps</span>
          <span className="tabular-nums opacity-70">
            {limited > 0 ? `${limited}/5 limited` : "open"}
          </span>
        </span>
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
      </button>

      {open && (
        <div className="border-t border-border px-2 py-2 space-y-1.5">
          {ACTIONS.map((a) => {
            const v = value[a.key];
            const disabled = v <= 0;
            return (
              <div key={a.key} className="space-y-0.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full"
                      style={{ background: a.tint }}
                    />
                    <span className={cn(disabled && "line-through opacity-50")}>
                      {a.label}
                    </span>
                  </span>
                  <span className={cn("tabular-nums", disabled ? "text-destructive" : "text-muted-foreground")}>
                    {disabled ? "off" : v.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={v}
                  onChange={(e) => update(a.key, parseFloat(e.target.value))}
                  className="h-1 w-full cursor-pointer appearance-none rounded bg-white/10 accent-secondary"
                  aria-label={`${a.label} cap`}
                  title={a.help}
                />
              </div>
            );
          })}
          <button
            onClick={reset}
            className="mt-1 flex w-full items-center justify-center gap-1 rounded border border-border bg-black/40 py-1 text-[9px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-2.5 w-2.5" />
            reset
          </button>
        </div>
      )}
    </div>
  );
}
