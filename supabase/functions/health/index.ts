import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Deployment health check.
 * Reports database reachability, AI gateway configuration and finance mode.
 * Always returns 200 with a machine-readable body so the client can degrade
 * gracefully instead of throwing.
 */
const VERSION = "1.0.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const started = Date.now();
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  const db = { ok: false, latencyMs: 0, error: null as string | null };

  if (url && serviceKey) {
    try {
      const supabase = createClient(url, serviceKey);
      const t0 = Date.now();
      const { error } = await supabase.from("farm_runs").select("run_key").limit(1);
      db.latencyMs = Date.now() - t0;
      if (error) db.error = error.message;
      else db.ok = true;
    } catch (e) {
      db.error = e instanceof Error ? e.message : "unknown error";
    }
  } else {
    db.error = "backend credentials not configured";
  }

  const body = {
    ok: db.ok,
    version: VERSION,
    ts: Date.now(),
    uptimeCheckMs: Date.now() - started,
    services: {
      database: db,
      ai: { configured: !!Deno.env.get("LOVABLE_API_KEY") },
      finance: { realMoneyEnabled: false, allowedModes: ["DRY_RUN", "SIMULATION", "PAPER_MODE"] },
    },
  };

  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    status: 200,
  });
});
