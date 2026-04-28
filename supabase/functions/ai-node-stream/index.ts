// AI node STREAM — long-lived SSE that emits single-node directives as the
// model produces them.
//
// Two providers are supported:
//   - default: Lovable AI Gateway (LOVABLE_API_KEY, model google/gemini-3-flash-preview)
//   - debug:   external OpenAI-compatible endpoint via AI_DEBUG_API_KEY +
//              AI_DEBUG_BASE_URL (+ AI_DEBUG_MODEL). Selected by passing
//              { provider: "debug" } in the request body. Used by the AI Debug
//              Panel to A/B compare directives from a third-party model.
//
// Overclock mode (?overclock=1 OR { overclock: true }) bumps the requested
// directive count from ~50 to ~120 so the client gets a much denser drip.

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

interface RequestBody extends FieldSnapshot {
  provider?: "default" | "debug";
  overclock?: boolean;
}

const TOTAL_AI_NODES = 71;

const baseSystemPrompt = (target: number) => `You are a LIVING control loop for a black-hole neural-mesh
simulation with ${TOTAL_AI_NODES} embedded AI nodes (ids 0-5 = CORE actuators,
6-70 = GOVERNORS that fine-tune the core).

You are streaming directives in real time. Emit a long sequence (~${target} items)
of small, decisive directives that:
- SELF-HEAL the field when stability drops or anomalies spike (release stuck
  isolated nodes, freeze runaway nodes briefly, then release).
- Inject RAPID MOVEMENT when stability is healthy: vary boost direction,
  occasionally fire short "anomaly" pulses on a couple of nodes for visual
  drama, then release them.
- Spread directives across many node ids — never spam the same node.
- Keep most intensities mild (|x| < 0.5); only push to 0.8+ for brief impulses.
- Reasons must be < 50 chars.

Emit one minified JSON object per line, no markdown.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body: RequestBody = await req.json();
    const { provider, overclock, ...snapshot } = body;
    const useDebug = provider === "debug";
    const targetCount = overclock ? 120 : 50;

    let endpoint: string;
    let apiKey: string;
    let model: string;

    if (useDebug) {
      const debugKey = Deno.env.get("AI_DEBUG_API_KEY");
      const debugBase = Deno.env.get("AI_DEBUG_BASE_URL");
      if (!debugKey || !debugBase) {
        return new Response(
          JSON.stringify({ error: "Debug provider not configured (AI_DEBUG_API_KEY / AI_DEBUG_BASE_URL missing)" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      endpoint = `${debugBase.replace(/\/$/, "")}/chat/completions`;
      apiKey = debugKey;
      model = Deno.env.get("AI_DEBUG_MODEL") ?? "gpt-4o-mini";
    } else {
      const lovKey = Deno.env.get("LOVABLE_API_KEY");
      if (!lovKey) throw new Error("LOVABLE_API_KEY not configured");
      endpoint = "https://ai.gateway.lovable.dev/v1/chat/completions";
      apiKey = lovKey;
      model = "google/gemini-3-flash-preview";
    }

    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        stream: true,
        messages: [
          { role: "system", content: baseSystemPrompt(targetCount) },
          {
            role: "system",
            content: `Output format: one minified JSON object per line, no
markdown, no commentary. Each line MUST match:
{"nodeId":<0-${TOTAL_AI_NODES - 1}>,"action":"boost|freeze|isolate|release|anomaly","intensity":<-1..1>,"reason":"<short>"}
Emit ~${targetCount} lines spread across many nodeIds, then stop.`,
          },
          {
            role: "user",
            content: `Field snapshot:\n${JSON.stringify(snapshot, null, 2)}\n\nBegin streaming directives now.`,
          },
        ],
      }),
    });

    if (upstream.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (upstream.status === 402) {
      return new Response(JSON.stringify({ error: "Credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!upstream.ok || !upstream.body) {
      const t = await upstream.text();
      console.error("AI gateway error", upstream.status, t);
      return new Response(JSON.stringify({ error: `Gateway error ${upstream.status}` }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body!.getReader();
        let upBuf = "";
        let textBuf = "";
        let done = false;

        const send = (obj: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        };

        send({ type: "open", provider: useDebug ? "debug" : "default", model, overclock: !!overclock });

        const flushTextLines = () => {
          let nl: number;
          while ((nl = textBuf.indexOf("\n")) !== -1) {
            const line = textBuf.slice(0, nl).trim();
            textBuf = textBuf.slice(nl + 1);
            if (!line) continue;
            const cleaned = line.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
            if (!cleaned.startsWith("{")) continue;
            try {
              const obj = JSON.parse(cleaned);
              if (
                typeof obj.nodeId === "number" &&
                typeof obj.action === "string" &&
                typeof obj.intensity === "number"
              ) {
                send({ type: "directive", directive: obj });
              }
            } catch {
              textBuf = cleaned + "\n" + textBuf;
              return;
            }
          }
        };

        try {
          while (!done) {
            const { value, done: rDone } = await reader.read();
            if (rDone) break;
            upBuf += decoder.decode(value, { stream: true });

            let nl: number;
            while ((nl = upBuf.indexOf("\n")) !== -1) {
              const raw = upBuf.slice(0, nl).replace(/\r$/, "");
              upBuf = upBuf.slice(nl + 1);
              if (!raw.startsWith("data: ")) continue;
              const payload = raw.slice(6).trim();
              if (payload === "[DONE]") { done = true; break; }
              try {
                const parsed = JSON.parse(payload);
                const delta: string | undefined =
                  parsed.choices?.[0]?.delta?.content ??
                  parsed.choices?.[0]?.message?.content;
                if (delta) {
                  textBuf += delta;
                  flushTextLines();
                }
              } catch { /* incomplete */ }
            }
          }
          if (textBuf.trim()) {
            textBuf += "\n";
            flushTextLines();
          }
          send({ type: "done" });
        } catch (e) {
          console.error("stream error", e);
          send({ type: "error", message: e instanceof Error ? e.message : "stream error" });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    console.error("ai-node-stream error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
