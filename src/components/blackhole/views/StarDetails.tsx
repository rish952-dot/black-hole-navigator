import { useState } from "react";
import { FEATURED_STARS, tempToHex, type FeaturedStar } from "../data/featured-stars";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ExternalLink } from "lucide-react";

/**
 * Browser of NASA/ESA reference stars with click-to-detail.
 *
 * The bundled list shows immediately. The "Fetch SIMBAD details" link
 * opens the canonical record in a new tab — a future iteration can wire
 * this to an edge function that fetches structured data.
 */
export function StarDetails() {
  const [selected, setSelected] = useState<FeaturedStar>(FEATURED_STARS[0]);

  return (
    <div className="grid h-full grid-cols-1 gap-3 md:grid-cols-[260px_1fr]">
      <ScrollArea className="h-full max-h-[60vh] rounded-md border border-border bg-card/40 md:max-h-none">
        <div className="space-y-1 p-2">
          {FEATURED_STARS.map((s) => {
            const hex = s.spectral === "BH" ? "#ff2244"
              : s.spectral === "NS" ? "#aa66ff"
              : tempToHex(s.temperature_k || 5500);
            return (
              <button
                key={s.id}
                onClick={() => setSelected(s)}
                className={`group flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-all ${
                  selected.id === s.id
                    ? "border-primary bg-primary/10"
                    : "border-transparent hover:border-border hover:bg-muted/40"
                }`}
              >
                <span
                  className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                  style={{
                    background: hex,
                    boxShadow: `0 0 8px ${hex}`,
                  }}
                />
                <span className="flex-1 font-mono text-[11px] text-foreground">
                  {s.name}
                </span>
                <span className="font-mono text-[9px] text-muted-foreground">
                  {s.spectral}
                </span>
              </button>
            );
          })}
        </div>
      </ScrollArea>

      <div className="space-y-3 overflow-auto rounded-md border border-border bg-card/40 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-foreground">{selected.name}</h3>
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {selected.id} · {selected.catalog}
            </p>
          </div>
          <Badge
            variant="outline"
            className="border-secondary/40 font-mono text-[10px] text-secondary"
          >
            {selected.agency}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-3 font-mono text-[11px]">
          <DetailRow label="RA"   value={`${selected.ra.toFixed(4)}°`} />
          <DetailRow label="Dec"  value={`${selected.dec.toFixed(4)}°`} />
          <DetailRow label="Distance" value={fmtDistance(selected.distance_pc)} />
          <DetailRow label="V-mag" value={selected.magnitude > 50 ? "—" : selected.magnitude.toFixed(2)} />
          <DetailRow label="B−V" value={selected.bv_color.toFixed(2)} />
          <DetailRow label="Spectral" value={selected.spectral} />
          <DetailRow label="Mass" value={`${fmtNum(selected.mass_solar)} M☉`} />
          <DetailRow label="Radius" value={`${fmtNum(selected.radius_solar)} R☉`} />
          <DetailRow label="T_eff" value={selected.temperature_k > 0 ? `${selected.temperature_k.toLocaleString()} K` : "—"} />
        </div>

        <div className="rounded-md border border-border bg-muted/30 p-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
          {selected.notes}
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <Button asChild size="sm" variant="outline" className="h-7 font-mono text-[10px]">
            <a
              href={`https://simbad.u-strasbg.fr/simbad/sim-id?Ident=${encodeURIComponent(selected.id)}`}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="mr-1 h-3 w-3" />
              SIMBAD
            </a>
          </Button>
          <Button asChild size="sm" variant="outline" className="h-7 font-mono text-[10px]">
            <a
              href={`https://exoplanetarchive.ipac.caltech.edu/cgi-bin/nstedAPI/nph-nstedAPI?table=ps&where=hostname+like+%27${encodeURIComponent(selected.name)}%25%27`}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="mr-1 h-3 w-3" />
              NASA Archive
            </a>
          </Button>
          <Button asChild size="sm" variant="outline" className="h-7 font-mono text-[10px]">
            <a
              href={`https://gea.esac.esa.int/archive/`}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink className="mr-1 h-3 w-3" />
              Gaia (ESA)
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-border/50 py-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

function fmtNum(n: number) {
  if (n === 0) return "—";
  if (n >= 1000) return n.toExponential(2);
  if (n < 0.01) return n.toExponential(2);
  return n.toFixed(2);
}

function fmtDistance(pc: number) {
  if (pc < 1e-3) return `${(pc * 206265).toFixed(0)} AU`;
  if (pc < 1) return `${pc.toFixed(3)} pc`;
  if (pc < 1000) return `${pc.toFixed(1)} pc`;
  if (pc < 1e6) return `${(pc / 1000).toFixed(2)} kpc`;
  return `${(pc / 1e6).toFixed(2)} Mpc`;
}
