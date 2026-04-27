// AI node STREAM — long-lived SSE that emits single-node directives as the
// model produces them. Each connection runs one streaming chat completion
// against the Lovable AI Gateway, parses the streamed JSON-array tool-call
// arguments incrementally, and forwards each completed `{nodeId, action,
// intensity, reason}` object to the client as an SSE `data:` frame.
//
// The client (useAIStream) reconnects every ~25s with a fresh field snapshot,
// so the model always reasons about current state.

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

const TOTAL_AI_NODES = 71;

const SYSTEM_PROMPT = `You are a LIVING control loop for a black-hole neural-mesh
simulation with ${TOTAL_AI_NODES} embedded AI nodes (ids 0-5 = CORE actuators,
6-70 = GOVERNORS that fine-tune the core).

You are streaming directives in real time. Emit a long sequence (40-80 items)
of small, decisive directives that:
- SELF-HEAL the field when stability drops or anomalies spike (release stuck
  isolated nodes, freeze runaway nodes briefly, then release).
- Inject RAPID MOVEMENT when stability is healthy: vary boost direction,
  occasionally fire short \"anomaly\" pulses on a couple of nodes for visual
  drama, then release them.
- Spread directives across many node ids — never spam the same node.
- Keep most intensities mild (|x| < 0.5); only push to 0.8+ for brief impulses.
- Reasons must be < 50 chars.

Emit directives via the emit_directive tool, one call per directive.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const snapshot: FieldSnapshot = await req.json();

    // We can't reliably stream tool-call arrays incrementally across all
    // models, so we ask for plain JSON-Lines text output and parse line-by-line
    // on the gateway response. The model is asked to emit one JSON object per
    // line, which is trivial to parse from a token stream.
    const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        stream: true,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "system",
            content: `Output format: one minified JSON object per line, no
markdown, no commentary. Each line MUST match:
{"nodeId":<0-${TOTAL_AI_NODES - 1}>,"action":"boost|freeze|isolate|release|anomaly","intensity":<-1..1>,"reason":"<short>"}
Emit ~50 lines spread across many nodeIds, then stop.`,
          },
          {
            role: "user",
            content: `Field snapshot:\n${JSON.stringify(snapshot, null, 2)}\n\nBegin streaming directives now.`,
          },
        ],
      }),
    });

    if (upstream.status === 429) {
      return new Response(
        JSON.stringify({ error: "Rate limited" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (upstream.status === 402) {
      return new Response(
        JSON.stringify({ error: "Credits exhausted" }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!upstream.ok || !upstream.body) {
      const t = await upstream.text();
      console.error("AI gateway error", upstream.status, t);
      return new Response(
        JSON.stringify({ error: "Gateway error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Transform the upstream OpenAI-style SSE chat stream into our own SSE
    // stream of single directive objects.
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body!.getReader();
        let upBuf = "";   // upstream SSE buffer
        let textBuf = ""; // accumulated assistant text (where JSON lines live)
        let done = false;

        const send = (obj: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        };

        // Ping to confirm the stream opened immediately on the client.
        send({ type: "open" });

        const flushTextLines = () => {
          let nl: number;
          while ((nl = textBuf.indexOf("\n")) !== -1) {
            const line = textBuf.slice(0, nl).trim();
            textBuf = textBuf.slice(nl + 1);
            if (!line) continue;
            // The model occasionally fences output despite instructions —
            // strip leading/trailing backticks / json markers.
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
              // Partial line — push back and wait.
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

            // Parse upstream OpenAI-style SSE: lines beginning with "data: ".
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
              } catch {
                /* incomplete chunk — wait for more */
              }
            }
          }
          // Final flush of any trailing object.
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
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
