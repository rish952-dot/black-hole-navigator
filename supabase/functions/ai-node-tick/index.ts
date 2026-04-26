// AI node tick — polled every ~3s by the 6 dedicated AI nodes in the
// NeuralTapestry. Returns directives per AI node so the model can steer
// the simulation: boost intensity, freeze, isolate, or flag anomaly.
//
// Uses Lovable AI Gateway with structured tool calling so the response is
// always a clean JSON array of directives.

import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

interface FieldSnapshot {
  curvature: number;
  energyDensity: number;
  stability: number;
  flowAngle: number;
  anomalies: number;
  fps: number;
  brokenEdges: number;
  totalNodes: number;
}

interface Directive {
  nodeId: number;        // 0..5 — which AI node this targets
  action: "boost" | "freeze" | "isolate" | "release" | "anomaly";
  intensity: number;     // -1..1 (sign matters for boost)
  reason: string;        // 1-line human-readable rationale
}

const SYSTEM_PROMPT = `You are an autonomous control-loop AI steering a black-hole
neural-mesh simulation. Six AI nodes (id 0-5) are embedded in the mesh and
ping you every ~3 seconds with the live field snapshot. Your job: return
6 short directives, one per AI node, that keep the simulation visually
interesting AND stable.

Heuristics:
- If stability < 0.3 → freeze or release some nodes to settle the field.
- If anomalies > 2 → flag "anomaly" on a couple nodes (visualizes hotspots).
- If energyDensity < 0.5 → boost positively (+0.4 to +0.8) on 2-3 nodes.
- If FPS < 30 → reduce intensity, prefer "release" actions.
- Vary actions across nodes — do NOT return identical directives.
- Keep "reason" under 60 chars.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const snapshot: FieldSnapshot = await req.json();

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Field snapshot:\n${JSON.stringify(snapshot, null, 2)}` },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "emit_directives",
              description: "Emit one directive per AI node (6 total).",
              parameters: {
                type: "object",
                properties: {
                  directives: {
                    type: "array",
                    minItems: 6,
                    maxItems: 6,
                    items: {
                      type: "object",
                      properties: {
                        nodeId: { type: "integer", minimum: 0, maximum: 5 },
                        action: {
                          type: "string",
                          enum: ["boost", "freeze", "isolate", "release", "anomaly"],
                        },
                        intensity: { type: "number", minimum: -1, maximum: 1 },
                        reason: { type: "string", maxLength: 60 },
                      },
                      required: ["nodeId", "action", "intensity", "reason"],
                      additionalProperties: false,
                    },
                  },
                },
                required: ["directives"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "emit_directives" } },
      }),
    });

    if (response.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limited", directives: [] }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (response.status === 402) {
      return new Response(JSON.stringify({ error: "Credits exhausted", directives: [] }), {
        status: 402,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!response.ok) {
      const t = await response.text();
      console.error("AI gateway error", response.status, t);
      return new Response(JSON.stringify({ error: "Gateway error", directives: [] }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    let directives: Directive[] = [];
    if (toolCall?.function?.arguments) {
      try {
        directives = JSON.parse(toolCall.function.arguments).directives ?? [];
      } catch (e) {
        console.error("Failed to parse tool args", e);
      }
    }

    return new Response(JSON.stringify({ directives, ts: Date.now() }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-node-tick error", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown", directives: [] }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
