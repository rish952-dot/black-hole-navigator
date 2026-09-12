import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";

/**
 * Persistent farm state: save / load a deterministic run snapshot.
 *
 * Finance is fail-closed: only simulation-class modes are accepted, and the
 * function never executes a payout. Tables are service-role only — the client
 * can reach them exclusively through this validated surface.
 */

const ALLOWED_MODES = ["DRY_RUN", "SIMULATION", "PAPER_MODE"] as const;

const GenerationSchema = z.object({
  index: z.number().int().nonnegative(),
  record: z.record(z.unknown()),
  metrics: z.record(z.unknown()).nullable().optional(),
});

const LedgerSchema = z.object({
  agentId: z.string().max(64),
  generation: z.number().int().nonnegative(),
  type: z.string().max(48),
  amount: z.number(),
  description: z.string().max(280),
  ts: z.number().optional(),
});

const SaveSchema = z.object({
  action: z.literal("save"),
  runKey: z.string().min(6).max(64).regex(/^[A-Za-z0-9_-]+$/),
  seed: z.number().int(),
  mode: z.string().max(32),
  generation: z.number().int().nonnegative(),
  halted: z.string().max(280).nullable().optional(),
  config: z.record(z.unknown()),
  totals: z.record(z.number()),
  health: z.record(z.unknown()).nullable().optional(),
  generations: z.array(GenerationSchema).max(200).default([]),
  ledger: z.array(LedgerSchema).max(500).default([]),
});

const LoadSchema = z.object({
  action: z.literal("load"),
  runKey: z.string().min(6).max(64).regex(/^[A-Za-z0-9_-]+$/),
});

const BodySchema = z.discriminatedUnion("action", [SaveSchema, LoadSchema]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    status,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "Backend not configured" }, 503);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);

  const supabase = createClient(url, serviceKey);

  try {
    if (parsed.data.action === "load") {
      const { runKey } = parsed.data;
      const { data: run, error: runErr } = await supabase
        .from("farm_runs")
        .select("*")
        .eq("run_key", runKey)
        .maybeSingle();
      if (runErr) return json({ error: runErr.message }, 500);
      if (!run) return json({ found: false }, 200);

      const { data: gens, error: genErr } = await supabase
        .from("farm_generations")
        .select("index, record, metrics")
        .eq("run_key", runKey)
        .order("index", { ascending: true })
        .limit(200);
      if (genErr) return json({ error: genErr.message }, 500);

      const { data: ledger } = await supabase
        .from("farm_ledger")
        .select("agent_id, generation, type, amount, description, ts")
        .eq("run_key", runKey)
        .order("id", { ascending: false })
        .limit(200);

      return json({ found: true, run, generations: gens ?? [], ledger: ledger ?? [] });
    }

    const body = parsed.data;
    if (!ALLOWED_MODES.includes(body.mode as (typeof ALLOWED_MODES)[number])) {
      return json(
        { error: `Mode "${body.mode}" refused — real-money execution is disabled`, allowedModes: ALLOWED_MODES },
        403,
      );
    }

    const { error: upErr } = await supabase.from("farm_runs").upsert(
      {
        run_key: body.runKey,
        seed: body.seed,
        mode: body.mode,
        generation: body.generation,
        halted: body.halted ?? null,
        config: body.config,
        totals: body.totals,
        health: body.health ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "run_key" },
    );
    if (upErr) return json({ error: upErr.message }, 500);

    if (body.generations.length) {
      const rows = body.generations.map((g) => ({
        run_key: body.runKey,
        index: g.index,
        record: g.record,
        metrics: g.metrics ?? null,
      }));
      const { error } = await supabase.from("farm_generations").upsert(rows, { onConflict: "run_key,index" });
      if (error) return json({ error: error.message }, 500);
    }

    if (body.ledger.length) {
      const rows = body.ledger.map((t) => ({
        run_key: body.runKey,
        agent_id: t.agentId,
        generation: t.generation,
        type: t.type,
        amount: t.amount,
        description: t.description,
        ts: new Date(t.ts ?? Date.now()).toISOString(),
      }));
      const { error } = await supabase.from("farm_ledger").insert(rows);
      if (error) return json({ error: error.message }, 500);
    }

    return json({
      ok: true,
      runKey: body.runKey,
      savedGenerations: body.generations.length,
      savedLedger: body.ledger.length,
      ts: Date.now(),
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unexpected error" }, 500);
  }
});
