type AgentVector = {
  sender: number;
  generation: number;
  opportunityId: string;
  strategy: number[];
  confidence: number;
  expectedValue: number;
  resourceCost: number;
  novelty: number;
  urgency: number;
  ttl: number;
};

const apiKey = process.env.XAI_API_KEY;
const baseUrl = (process.env.XAI_BASE_URL ?? "https://api.x.ai").replace(/\/$/, "");
const model = process.env.XAI_MODEL || "grok-4.6";
if (!apiKey) throw new Error("XAI_API_KEY is missing from GitHub Secrets");

const system =
  "Vector node only. Use very short output. Return ONLY JSON with confidence, novelty, urgency, strategy. All numbers 0..1. No prose. No profit claims.";

const seed: AgentVector = {
  sender: 0,
  generation: 0,
  opportunityId: "mesh-test-1",
  strategy: [0.45, 0.6, 0.5, 0.25, 0.4],
  confidence: 0.55,
  expectedValue: 4,
  resourceCost: 1,
  novelty: 0.6,
  urgency: 0.4,
  ttl: 3,
};

function parse(raw: string): Omit<AgentVector, "sender" | "generation" | "opportunityId" | "expectedValue" | "resourceCost" | "ttl"> {
  const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;
  const clamp = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
  };
  return {
    confidence: clamp(parsed.confidence, seed.confidence),
    novelty: clamp(parsed.novelty, seed.novelty),
    urgency: clamp(parsed.urgency, seed.urgency),
    strategy: Array.isArray(parsed.strategy)
      ? parsed.strategy.slice(0, 5).map((x) => clamp(x, 0.5))
      : seed.strategy,
  };
}

async function callNode(nodeId: number): Promise<AgentVector> {
  const compact = JSON.stringify({
    n: nodeId,
    o: seed.opportunityId,
    s: seed.strategy,
    c: seed.confidence,
    e: seed.expectedValue,
    cost: seed.resourceCost,
    nov: seed.novelty,
    urg: seed.urgency,
  });

  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 80,
      messages: [
        { role: "system", content: system },
        { role: "user", content: compact },
      ],
    }),
  });

  if (!response.ok) throw new Error(`node ${nodeId}: xAI HTTP ${response.status}`);
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { total_tokens?: number };
  };
  const raw = body.choices?.[0]?.message?.content;
  if (!raw) throw new Error(`node ${nodeId}: empty xAI response`);
  const vector = parse(raw);
  return {
    ...seed,
    ...vector,
    sender: nodeId,
  };
}

const started = performance.now();
const results = await Promise.all([callNode(1), callNode(2)]);
const elapsedMs = +(performance.now() - started).toFixed(1);

const result = {
  status: "XAI_VECTOR_CONNECTIVITY_PASS",
  provider: "xai",
  model,
  nodes: 2,
  communication: "vector_only",
  maxTokensPerRequest: 80,
  elapsedMs,
  validVectors: results.length,
  vectors: results,
  note: "Connectivity test only. No task execution, payment, wallet, or external account access.",
};

await Bun.write("xai-mesh-test.json", JSON.stringify(result, null, 2));
await Bun.write(
  "xai-mesh-test.md",
  `# xAI Mesh Test\n\n- Status: ${result.status}\n- Model: ${model}\n- Nodes: 2\n- Communication: vector_only\n- Valid vectors: ${results.length}\n- Time: ${elapsedMs} ms\n\nNo financial or external-account actions were performed.\n`,
);
console.log(JSON.stringify(result, null, 2));
